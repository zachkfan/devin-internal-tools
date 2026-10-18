import { requireAccess } from "@/platform/guard";
import { Badge, DataTable, PageHeader, Stat, Tabs, fmtMoney, fmtTime } from "@/platform/ui/primitives";
import { manifest } from "./_app/manifest";
import { NETWORK_LABEL, REASON_LABEL, STATUSES, countByStatus, listDisputes, type DisputeStatus } from "./_app/queries";
import { REASON_TONE, STATUS_TONE, daysLeftLabel } from "./_app/tones";

export default async function ChargebacksQueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAccess(manifest.readPermission);
  const { status: raw } = await searchParams;
  const status = (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as DisputeStatus) : "open";
  const counts = countByStatus();
  const open = listDisputes("open");
  const disputes = status === "open" ? open : listDisputes(status);

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open" value={counts.open} tone="blue" />
        <Stat label="Due in < 3 days" value={open.filter((d) => d.urgent).length} tone="red" />
        <Stat label="Open amount" value={fmtMoney(open.reduce((sum, d) => sum + d.amountCents, 0))} />
        <Stat label="Open over $1,000" value={open.filter((d) => d.contestNeedsApproval).length} tone="yellow" />
      </div>
      <Tabs active={status} tabs={STATUSES.map((s) => ({ key: s, label: s, href: `/apps/chargebacks?status=${s}`, count: counts[s] }))} />
      <DataTable
        rows={disputes}
        rowHref={(d) => `/apps/chargebacks/${d.id}`}
        empty="No disputes here."
        columns={[
          { header: "Dispute", cell: (d) => `#${d.id}` },
          {
            header: "Days left",
            cell: (d) => (d.status === "open" ? <Badge tone={d.urgent ? "red" : "green"}>{daysLeftLabel(d.daysLeft)}</Badge> : <span className="text-slate-400">—</span>),
          },
          { header: "Respond by", cell: (d) => <span className="whitespace-nowrap">{d.respondBy}</span> },
          {
            header: "Amount",
            className: "whitespace-nowrap",
            cell: (d) => (
              <>
                {fmtMoney(d.amountCents, d.currency)}
                {d.contestNeedsApproval && <span className="ml-1"><Badge tone="yellow">&gt; $1k</Badge></span>}
              </>
            ),
          },
          { header: "Reason", cell: (d) => <span className="whitespace-nowrap"><Badge tone={REASON_TONE[d.reasonCategory]}>{REASON_LABEL[d.reasonCategory]}</Badge> <code className="text-xs text-slate-500">{d.reasonCode}</code></span> },
          { header: "Network", cell: (d) => NETWORK_LABEL[d.network] },
          { header: "Cardholder", cell: (d) => d.cardholderName },
          { header: "Card", cell: (d) => <span className="font-mono text-xs">{d.cardMasked}</span> },
          { header: "Evidence", cell: (d) => (d.evidenceCount ? `${d.evidenceCount} note${d.evidenceCount === 1 ? "" : "s"}` : <span className="text-amber-700">none</span>) },
          { header: "Status", cell: (d) => <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge> },
          ...(status === "open" ? [] : [{ header: "Decided", cell: (d: (typeof disputes)[number]) => <span className="whitespace-nowrap text-slate-500">{d.decidedBy} · {fmtTime(d.decidedAt)}</span> }]),
        ]}
      />
    </>
  );
}
