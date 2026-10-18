import { pendingFor, recentDecisions, requestsBy, type ApprovalRequest } from "@/platform/approvals";
import { requireUser } from "@/platform/auth";
import { getApp } from "@/platform/registry";
import { decideApproval } from "@/platform/server-actions";
import { ActionForm } from "@/platform/ui/ActionForm";
import { Badge, Card, DataTable, PageHeader, fmtTime } from "@/platform/ui/primitives";

const STATUS_TONE = { pending: "yellow", approved: "green", rejected: "purple", failed: "red" } as const;

function RequestList({ rows, empty }: { rows: ApprovalRequest[]; empty: string }) {
  return (
    <DataTable rows={rows} empty={empty} columns={[
      { header: "#", cell: (r) => r.id },
      { header: "App", cell: (r) => getApp(r.app)?.name ?? r.app },
      { header: "Request", cell: (r) => r.summary },
      { header: "By", cell: (r) => r.requested_by },
      { header: "Status", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
      { header: "Decided by", cell: (r) => (r.decided_by ? `${r.decided_by}: ${r.decision_reason}` : "") },
    ]} />
  );
}

export default async function ApprovalsPage() {
  const user = await requireUser();
  const waiting = pendingFor(user);
  return (
    <>
      <PageHeader title="Approvals" description="Maker-checker for every app: sensitive actions wait here for a second person. You can't approve your own request." />
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Waiting for you ({waiting.length})</h2>
      <div className="mb-8 space-y-3">
        {waiting.length === 0 && <p className="text-sm text-slate-500">Nothing needs your approval.</p>}
        {waiting.map((r) => (
          <Card key={r.id}>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <Badge tone="yellow">#{r.id}</Badge>
              <span className="font-medium">{r.summary}</span>
            </div>
            <p className="mb-3 text-sm text-slate-600">
              Requested by <b>{r.requested_by}</b> · {fmtTime(r.requested_at)} · &ldquo;{r.request_reason}&rdquo;
            </p>
            <ActionForm compact action={decideApproval} hidden={{ requestId: r.id }} submits={[
              { label: "Approve", name: "decision", value: "approve" },
              { label: "Reject", name: "decision", value: "reject", tone: "danger" },
            ]} />
          </Card>
        ))}
      </div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Your requests</h2>
      <div className="mb-8"><RequestList rows={requestsBy(user)} empty="You haven't requested anything." /></div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent decisions</h2>
      <RequestList rows={recentDecisions()} empty="No decisions yet." />
    </>
  );
}
