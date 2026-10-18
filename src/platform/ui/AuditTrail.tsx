import { listAudit, type AuditOutcome } from "../audit";
import { approvalsForTarget } from "../approvals";
import { Badge, DataTable, fmtTime, type Tone } from "./primitives";

export const OUTCOME_TONE: Record<AuditOutcome, Tone> = {
  success: "green", denied: "red", error: "red", requested: "yellow", approved: "blue", rejected: "purple",
};

/** Audit history for one record (pass target) or one app. */
export function AuditTrail({ target, app, limit = 50 }: { target?: string; app?: string; limit?: number }) {
  const rows = listAudit({ target, app, limit });
  return (
    <DataTable
      rows={rows}
      empty="No audit events yet."
      columns={[
        { header: "When", cell: (r) => <span className="whitespace-nowrap text-slate-500">{fmtTime(r.at)}</span> },
        { header: "Who", cell: (r) => r.actorId },
        { header: "Action", cell: (r) => <code className="text-xs">{r.app}.{r.action}</code> },
        { header: "Outcome", cell: (r) => <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge> },
        { header: "Reason", cell: (r) => r.reason },
      ]}
    />
  );
}

/** Shows any maker-checker requests attached to a record. */
export function ApprovalStatus({ target }: { target: string }) {
  const reqs = approvalsForTarget(target);
  if (reqs.length === 0) return null;
  const tone = { pending: "yellow", approved: "green", rejected: "purple", failed: "red" } as const;
  return (
    <ul className="space-y-1 text-sm">
      {reqs.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <Badge tone={tone[r.status]}>{r.status}</Badge>
          <span>Request #{r.id} by {r.requested_by}{r.decided_by ? `, decided by ${r.decided_by}` : ", awaiting a second approver"}</span>
          {r.decision_reason && <span className="text-slate-500">({r.decision_reason})</span>}
        </li>
      ))}
    </ul>
  );
}
