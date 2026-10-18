import { ActionError, perform, type ActionState } from "./action";
import { findAction } from "./action-index";
import { writeAudit } from "./audit";
import { getUser, type User } from "./auth";
import { db, tx } from "./db";
import { can } from "./rbac";

export type ApprovalRequest = {
  id: number; app: string; action: string; payload: string; summary: string; target: string | null;
  requested_by: string; requested_at: string; request_reason: string;
  status: "pending" | "approved" | "rejected" | "failed";
  decided_by: string | null; decided_at: string | null; decision_reason: string | null;
};

const all = (sql: string, ...args: (string | number)[]) => db().prepare(sql).all(...args) as ApprovalRequest[];

export const getRequest = (id: number) =>
  db().prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRequest | undefined;

export function approverPermissionOf(req: ApprovalRequest) {
  return findAction(req.app, req.action)?.def.approval?.approverPermission;
}

/** Pending requests this user may decide: has the approver permission and is not the requester. */
export function pendingFor(user: User): ApprovalRequest[] {
  return all("SELECT * FROM approval_requests WHERE status = 'pending' AND requested_by != ? ORDER BY id", user.id).filter((r) => {
    const perm = approverPermissionOf(r);
    return perm !== undefined && can(user, perm);
  });
}

export const requestsBy = (user: User) => all("SELECT * FROM approval_requests WHERE requested_by = ? ORDER BY id DESC LIMIT 50", user.id);
export const recentDecisions = () => all("SELECT * FROM approval_requests WHERE status != 'pending' ORDER BY decided_at DESC LIMIT 20");
export const approvalsForTarget = (target: string) => all("SELECT * FROM approval_requests WHERE target = ? ORDER BY id DESC", target);

/** Checker step of maker-checker. Approving executes the original action as the requester, atomically. */
export function decide(user: User, requestId: number, decision: "approve" | "reject", rawReason: string): ActionState {
  const reason = rawReason.trim();
  const req = getRequest(requestId);
  if (!req) return { ok: false, message: `Request #${requestId} not found.` };
  if (req.status !== "pending") return { ok: false, message: `Request #${requestId} is already ${req.status}.` };
  const action = findAction(req.app, req.action);
  const policy = action?.def.approval;
  if (!action || !policy) return { ok: false, message: `Unknown action ${req.app}.${req.action}.` };

  const deny = (message: string, why: string) => {
    writeAudit({ actorId: user.id, app: req.app, action: req.action, outcome: "denied", target: req.target ?? undefined, reason, details: { approvalId: req.id, why } });
    return { ok: false, message };
  };
  if (req.requested_by === user.id) return deny("You can't approve your own request (four-eyes rule).", "self-approval");
  if (!can(user, policy.approverPermission)) return deny(`You need ${policy.approverPermission} to decide this.`, "missing approver permission");
  if (!reason) return { ok: false, message: "A reason is required." };

  const requester = getUser(req.requested_by);
  const decided = (status: ApprovalRequest["status"], note: string) =>
    db().prepare("UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?")
      .run(status, user.id, new Date().toISOString(), note, req.id);

  if (decision === "reject") {
    tx(() => {
      decided("rejected", reason);
      writeAudit({ actorId: user.id, app: req.app, action: req.action, outcome: "rejected", target: req.target ?? undefined, reason, details: { approvalId: req.id } });
    });
    return { ok: true, message: `Rejected request #${req.id}.` };
  }

  try {
    tx(() => {
      decided("approved", reason);
      writeAudit({ actorId: user.id, app: req.app, action: req.action, outcome: "approved", target: req.target ?? undefined, reason, details: { approvalId: req.id } });
      if (!requester || !can(requester, action.def.permission)) throw new ActionError("Requester no longer has permission for this action.");
      perform(action.def, requester, action.def.input.parse(JSON.parse(req.payload)), req.request_reason, { approvedBy: user, approvalId: req.id });
    });
    return { ok: true, message: `Approved and executed request #${req.id}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tx(() => {
      decided("failed", msg);
      writeAudit({ actorId: user.id, app: req.app, action: req.action, outcome: "error", target: req.target ?? undefined, reason, details: { approvalId: req.id, error: msg } });
    });
    return { ok: false, message: `Approval failed and was rolled back: ${e instanceof ActionError ? msg : "unexpected error (logged)"}.` };
  }
}
