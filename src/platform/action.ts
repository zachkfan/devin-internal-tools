import type { z } from "zod";
import { writeAudit } from "./audit";
import type { User } from "./auth";
import { db, tx } from "./db";
import { can } from "./rbac";

/** Throw from run() for expected business errors; the message is shown to the user. */
export class ActionError extends Error {}

export type ActionState = { ok: boolean; message: string; data?: unknown; at?: number } | null;

export type ActionContext = {
  /** Who initiated the action (the "maker"). */
  user: User;
  /** Set when the action runs after a second person approved it (the "checker"). */
  approvedBy?: User;
  reason: string;
  /** Override the audit target, e.g. after inserting a row and learning its id. */
  setTarget(target: string): void;
  /** Extra audit details (e.g. before/after values). Never include raw PII. */
  record(details: Record<string, unknown>): void;
};

export type ApprovalPolicy<I> = {
  /** Return true when this invocation needs a second person (e.g. amount over a threshold, prod environment). */
  required: (input: I, user: User) => boolean;
  /** Permission the approver must hold. The approver can never be the requester. */
  approverPermission: string;
  /** One line shown in the approvals inbox. */
  summary: (input: I) => string;
};

export type ActionDef<S extends z.ZodType, R> = {
  app: string;
  name: string;
  permission: string;
  /** FormData values arrive as strings: use z.coerce.number() etc. */
  input: S;
  /** Defaults to true. Only set false for low-risk actions like claiming a case. */
  requireReason?: boolean;
  approval?: ApprovalPolicy<z.infer<S>>;
  /** Audit target for this invocation, e.g. `refund:${input.refundId}`. */
  target?: (input: z.infer<S>) => string;
  /** Free-text input fields that may contain customer data; replaced with "[redacted]" in every audit entry (success, request, error). */
  redact?: (keyof z.infer<S> & string)[];
  /** Synchronous; runs inside a DB transaction together with its audit entry. Return a message or data. */
  run: (input: z.infer<S>, ctx: ActionContext) => R;
};

export type PlatformAction = ((prev: ActionState, formData: FormData) => Promise<ActionState>) & {
  __platformAction: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: ActionDef<any, unknown>;
  /** Invoke without Next.js (tests, scripts). */
  invoke: (user: User, input: unknown, reason?: string) => ActionState;
};

function auditInput<S extends z.ZodType, R>(def: ActionDef<S, R>, input: unknown): unknown {
  if (!def.redact?.length || !input || typeof input !== "object") return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of def.redact) if (k in copy) copy[k] = "[redacted]";
  return copy;
}

/** Executes the action body and writes its audit entry. Caller must hold a transaction. */
export function perform<S extends z.ZodType, R>(
  def: ActionDef<S, R>,
  user: User,
  input: z.infer<S>,
  reason: string,
  extra: { approvedBy?: User; approvalId?: number } = {},
): R {
  let target = def.target?.(input);
  const details: Record<string, unknown> = { input: auditInput(def, input) };
  const result = def.run(input, {
    user,
    approvedBy: extra.approvedBy,
    reason,
    setTarget: (t) => (target = t),
    record: (d) => Object.assign(details, d),
  });
  if (extra.approvalId) Object.assign(details, { approvalId: extra.approvalId, approvedBy: extra.approvedBy?.id });
  writeAudit({ actorId: user.id, app: def.app, action: def.name, outcome: "success", target, reason, details });
  return result;
}

function execute<S extends z.ZodType, R>(def: ActionDef<S, R>, user: User, raw: unknown, rawReason: string): ActionState {
  const reason = rawReason.trim();
  if (!can(user, def.permission)) {
    writeAudit({ actorId: user.id, app: def.app, action: def.name, outcome: "denied", reason, details: { permission: def.permission } });
    return { ok: false, message: `You don't have permission to do this (${def.permission}).` };
  }
  const parsed = def.input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  }
  if ((def.requireReason ?? true) && !reason) return { ok: false, message: "A reason is required for this action." };
  const input = parsed.data;
  try {
    if (def.approval?.required(input, user)) {
      const policy = def.approval;
      const id = tx(() => {
        const target = def.target?.(input) ?? null;
        const res = db()
          .prepare(
            `INSERT INTO approval_requests (app, action, payload, summary, target, requested_by, requested_at, request_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(def.app, def.name, JSON.stringify(input), policy.summary(input), target, user.id, new Date().toISOString(), reason);
        const requestId = Number(res.lastInsertRowid);
        writeAudit({
          actorId: user.id, app: def.app, action: def.name, outcome: "requested", target: target ?? undefined, reason,
          details: { input: auditInput(def, input), approvalId: requestId, approverPermission: policy.approverPermission },
        });
        return requestId;
      });
      return { ok: true, message: `Needs a second approver: sent to the approvals inbox as request #${id}.` };
    }
    const result = tx(() => perform(def, user, input, reason));
    return typeof result === "string" ? { ok: true, message: result } : { ok: true, message: "Done.", data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeAudit({ actorId: user.id, app: def.app, action: def.name, outcome: "error", target: def.target?.(input), reason, details: { input: auditInput(def, input), error: msg } });
    if (!(e instanceof ActionError)) console.error(e);
    return { ok: false, message: e instanceof ActionError ? msg : "Unexpected error (logged)." };
  }
}

/**
 * The only sanctioned way for an app to change data. Wraps a server action with:
 * authn -> RBAC check -> input validation -> required reason -> optional maker-checker approval
 * -> transactional run + audit entry. Export the result from an app's `_app/actions.ts` ("use server").
 */
export function defineAction<S extends z.ZodType, R>(def: ActionDef<S, R>): PlatformAction {
  const handler = async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    const { requireUser } = await import("./auth");
    const user = await requireUser();
    const raw = Object.fromEntries([...formData.entries()].filter(([k]) => k !== "reason" && !k.startsWith("$ACTION")));
    const state = execute(def, user, raw, String(formData.get("reason") ?? ""));
    if (state?.ok) {
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/", "layout");
    }
    return { ...state!, at: Date.now() };
  };
  return Object.assign(handler, {
    __platformAction: true as const,
    def,
    invoke: (user: User, input: unknown, reason = "") => execute(def, user, input, reason),
  });
}

export const isPlatformAction = (v: unknown): v is PlatformAction =>
  typeof v === "function" && (v as Partial<PlatformAction>).__platformAction === true;
