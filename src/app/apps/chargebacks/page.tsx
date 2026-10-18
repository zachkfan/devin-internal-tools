import Link from "next/link";
import { requireAccess } from "@/platform/guard";
import { Badge, DataTable, PageHeader, Stat, fmtMoney, fmtTime } from "@/platform/ui/primitives";
import { manifest } from "./_app/manifest";
import { DISPUTE_SORTS, NETWORK_LABEL, REASON_LABEL, STATUSES, listDisputes, type DisputeSort, type DisputeStatus } from "./_app/queries";
import { REASON_TONE, STATUS_LABEL, STATUS_TONE, daysLeftLabel } from "./_app/tones";

const SORT_LABEL: Record<DisputeSort, string> = {
  deadline_asc: "Deadline: soonest first",
  deadline_desc: "Deadline: latest first",
  amount_desc: "Amount: high to low",
  amount_asc: "Amount: low to high",
  opened_desc: "Opened: newest first",
  opened_asc: "Opened: oldest first",
};
const SELECT_CLASS = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";
const DEFAULT_STATUS: DisputeStatus = "open";
const DEFAULT_SORT: DisputeSort = "deadline_asc";

export default async function ChargebacksQueuePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; sort?: string }> }) {
  await requireAccess(manifest.readPermission);
  const { q = "", status: rawStatus, sort: rawSort } = await searchParams;
  // The queue defaults to open disputes; "all" lifts the status filter.
  const status: DisputeStatus | undefined =
    rawStatus === "all" ? undefined : (STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as DisputeStatus) : DEFAULT_STATUS;
  const sort: DisputeSort = (DISPUTE_SORTS as string[]).includes(rawSort ?? "") ? (rawSort as DisputeSort) : DEFAULT_SORT;
  const filtered = Boolean(q || status !== DEFAULT_STATUS || sort !== DEFAULT_SORT);
  const open = listDisputes("", { status: "open" });
  const disputes = listDisputes(q, { status, sort });

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open" value={open.length} tone="blue" />
        <Stat label="Due in < 3 days" value={open.filter((d) => d.urgent).length} tone="red" />
        <Stat label="Open amount" value={fmtMoney(open.reduce((sum, d) => sum + d.amountCents, 0))} />
        <Stat label="Open over $1,000" value={open.filter((d) => d.contestNeedsApproval).length} tone="yellow" />
      </div>
      <form action="/apps/chargebacks" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search cardholder, merchant ref, reason code, card last 4 or dispute #"
          className="w-full max-w-md rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <select name="status" defaultValue={status ?? "all"} aria-label="Dispute status" className={SELECT_CLASS}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort by" className={SELECT_CLASS}>
          {DISPUTE_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
        <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
        {filtered && <Link href="/apps/chargebacks" className="self-center text-sm text-blue-700 hover:underline">Clear</Link>}
      </form>
      <DataTable
        rows={disputes}
        rowHref={(d) => `/apps/chargebacks/${d.id}`}
        empty={q || status !== DEFAULT_STATUS ? "No disputes match these filters." : "No open disputes."}
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
          { header: "Status", cell: (d) => <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge> },
          ...(status === "open" ? [] : [{ header: "Decided", cell: (d: (typeof disputes)[number]) => (d.decidedBy ? <span className="whitespace-nowrap text-slate-500">{d.decidedBy} · {fmtTime(d.decidedAt)}</span> : <span className="text-slate-400">—</span>) }]),
        ]}
      />
    </>
  );
}
