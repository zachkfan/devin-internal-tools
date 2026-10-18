import { createHash } from "node:crypto";
import { db } from "./db";

export type AuditOutcome = "success" | "denied" | "error" | "requested" | "approved" | "rejected";

export type AuditInput = {
  actorId: string;
  app: string;
  action: string;
  outcome: AuditOutcome;
  target?: string;
  reason?: string;
  details?: Record<string, unknown>;
};

export type AuditEntry = Required<Omit<AuditInput, "details" | "target" | "reason">> & {
  seq: number;
  at: string;
  target: string | null;
  reason: string | null;
  details: string;
  hash: string;
};

const GENESIS = "GENESIS";

function digest(prev: string, at: string, e: AuditInput, details: string) {
  return createHash("sha256")
    .update([prev, at, e.actorId, e.app, e.action, e.outcome, e.target ?? "", e.reason ?? "", details].join("\u001f"))
    .digest("hex");
}

/**
 * Append-only, hash-chained audit log. UPDATE/DELETE are blocked by triggers; editing a row via raw file access
 * breaks the chain and is detected by verifyAuditChain(). Production: also stream to WORM storage / SIEM.
 */
export function writeAudit(e: AuditInput) {
  const conn = db();
  const last = conn.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  const prev = last?.hash ?? GENESIS;
  const at = new Date().toISOString();
  const details = JSON.stringify(e.details ?? {});
  conn
    .prepare(
      `INSERT INTO audit_log (at, actor_id, app, action, outcome, target, reason, details, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(at, e.actorId, e.app, e.action, e.outcome, e.target ?? null, e.reason ?? null, details, prev, digest(prev, at, e, details));
}

type Row = {
  seq: number; at: string; actor_id: string; app: string; action: string; outcome: AuditOutcome;
  target: string | null; reason: string | null; details: string; prev_hash: string; hash: string;
};

const toEntry = (r: Row): AuditEntry => ({
  seq: r.seq, at: r.at, actorId: r.actor_id, app: r.app, action: r.action, outcome: r.outcome,
  target: r.target, reason: r.reason, details: r.details, hash: r.hash,
});

export function listAudit(filter: { app?: string; target?: string; limit?: number } = {}): AuditEntry[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.app) (where.push("app = ?"), args.push(filter.app));
  if (filter.target) (where.push("target = ?"), args.push(filter.target));
  const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ${filter.limit ?? 200}`;
  return (db().prepare(sql).all(...args) as Row[]).map(toEntry);
}

export function verifyAuditChain(): { ok: boolean; count: number; brokenAt?: number } {
  const rows = db().prepare("SELECT * FROM audit_log ORDER BY seq ASC").all() as Row[];
  let prev = GENESIS;
  for (const r of rows) {
    const expected = digest(prev, r.at, {
      actorId: r.actor_id, app: r.app, action: r.action, outcome: r.outcome,
      target: r.target ?? undefined, reason: r.reason ?? undefined,
    }, r.details);
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, count: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, count: rows.length };
}
