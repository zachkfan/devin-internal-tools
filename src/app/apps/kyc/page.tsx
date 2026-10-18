import { requireAccess } from "@/platform/guard";
import { Badge, DataTable, PageHeader, Stat, Tabs, fmtTime } from "@/platform/ui/primitives";
import { manifest } from "./_app/manifest";
import { countByStatus, listCases, STATUSES, type KycStatus } from "./_app/queries";
import { RISK_TONE, STATUS_TONE } from "./_app/tones";

export default async function KycQueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAccess(manifest.readPermission);
  const { status: raw } = await searchParams;
  const status = (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as KycStatus) : "pending";
  const counts = countByStatus();
  const cases = listCases(status);

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pending" value={counts.pending} />
        <Stat label="In review" value={counts.in_review} tone="blue" />
        <Stat label="Escalated" value={counts.escalated} tone="purple" />
        <Stat label="High risk open" value={listCases("pending").filter((c) => c.risk === "high").length} tone="red" />
      </div>
      <Tabs active={status} tabs={STATUSES.map((s) => ({ key: s, label: s.replace("_", " "), href: `/apps/kyc?status=${s}`, count: counts[s] }))} />
      <DataTable
        rows={cases}
        rowHref={(c) => `/apps/kyc/${c.id}`}
        empty="Queue is empty."
        columns={[
          { header: "Case", cell: (c) => `#${c.id}` },
          { header: "Customer", cell: (c) => c.customerName },
          { header: "Email", cell: (c) => <span className="font-mono text-xs">{c.emailMasked}</span> },
          { header: "Country", cell: (c) => c.country },
          { header: "Risk", cell: (c) => <Badge tone={RISK_TONE[c.risk]}>{c.risk} · {c.riskScore}</Badge> },
          { header: "Flags", cell: (c) => <span className="text-xs text-slate-600">{c.flags.join(", ")}</span> },
          { header: "Status", cell: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ")}</Badge> },
          { header: "Assignee", cell: (c) => c.assignedTo ?? "—" },
          { header: "Submitted", cell: (c) => <span className="whitespace-nowrap text-slate-500">{fmtTime(c.submittedAt)}</span> },
        ]}
      />
    </>
  );
}
