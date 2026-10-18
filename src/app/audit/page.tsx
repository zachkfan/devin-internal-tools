import { listAudit, verifyAuditChain } from "@/platform/audit";
import { requireAccess } from "@/platform/guard";
import { apps } from "@/platform/registry";
import { OUTCOME_TONE } from "@/platform/ui/AuditTrail";
import { Badge, DataTable, PageHeader, Tabs, fmtTime } from "@/platform/ui/primitives";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  await requireAccess("platform:audit_read");
  const { app } = await searchParams;
  const chain = verifyAuditChain();
  const rows = listAudit({ app, limit: 300 });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only and hash-chained. Every action, denial, PII reveal, approval and login across every app lands here."
        actions={<Badge tone={chain.ok ? "green" : "red"}>{chain.ok ? `Chain verified · ${chain.count} entries` : `Chain BROKEN at #${chain.brokenAt}`}</Badge>}
      />
      <Tabs active={app ?? "all"} tabs={[{ key: "all", label: "All", href: "/audit" }, { key: "platform", label: "Platform", href: "/audit?app=platform" },
        ...apps.map((a) => ({ key: a.id, label: a.name, href: `/audit?app=${a.id}` }))]} />
      <DataTable rows={rows} columns={[
        { header: "#", cell: (r) => r.seq },
        { header: "When", cell: (r) => <span className="whitespace-nowrap text-slate-500">{fmtTime(r.at)}</span> },
        { header: "Who", cell: (r) => r.actorId },
        { header: "Action", cell: (r) => <code className="text-xs">{r.app}.{r.action}</code> },
        { header: "Outcome", cell: (r) => <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge> },
        { header: "Target", cell: (r) => <code className="text-xs">{r.target}</code> },
        { header: "Reason", cell: (r) => r.reason },
        { header: "Details", cell: (r) => <code className="block max-w-md truncate text-xs text-slate-500" title={r.details}>{r.details}</code> },
      ]} />
    </>
  );
}
