import Link from "next/link";
import { requireAccess } from "@/platform/guard";
import { Badge, DataTable, PageHeader, Stat, Tabs, fmtMoney, fmtTime } from "@/platform/ui/primitives";
import { manifest } from "./_app/manifest";
import { listPendingRefunds, listRefunds, listTransactions, refundStats } from "./_app/queries";
import { REFUND_STATE_LABEL, REFUND_STATE_TONE } from "./_app/tones";

const TABS = ["transactions", "history", "pending"] as const;
type Tab = (typeof TABS)[number];

export default async function RefundsDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  await requireAccess(manifest.readPermission);
  const { tab: rawTab, q = "" } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "transactions";
  const stats = refundStats();
  const refunds = listRefunds();
  const pending = listPendingRefunds();

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Refunded (7 days)" value={fmtMoney(stats.refunded7dCents)} tone="blue" />
        <Stat label="Refunds (7 days)" value={stats.refunds7dCount} />
        <Stat label="Awaiting approval" value={stats.pendingApprovals} tone={stats.pendingApprovals > 0 ? "yellow" : "gray"} />
        <Stat label="Refund rate" value={`${(stats.refundRate * 100).toFixed(1)}%`} tone="purple" />
      </div>
      <Tabs active={tab} tabs={[
        { key: "transactions", label: "Transactions", href: "/apps/refunds" },
        { key: "history", label: "Refund history", href: "/apps/refunds?tab=history", count: refunds.length },
        { key: "pending", label: "Pending approval", href: "/apps/refunds?tab=pending", count: pending.length },
      ]} />

      {tab === "transactions" && (
        <>
          <form action="/apps/refunds" className="mb-4 flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search customer, merchant, card last 4 or transaction #"
              className="w-full max-w-md rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
            <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Search</button>
            {q && <Link href="/apps/refunds" className="self-center text-sm text-blue-700 hover:underline">Clear</Link>}
          </form>
          <DataTable
            rows={listTransactions(q)}
            rowHref={(t) => `/apps/refunds/${t.id}`}
            empty={q ? `No transactions match "${q}".` : "No transactions."}
            columns={[
              { header: "Txn", cell: (t) => `#${t.id}` },
              { header: "Customer", cell: (t) => t.customerName },
              { header: "Card", cell: (t) => <span className="whitespace-nowrap font-mono text-xs">{t.cardBrand} {t.cardMasked}</span> },
              { header: "Merchant", cell: (t) => <span className="font-mono text-xs">{t.merchant}</span> },
              { header: "Amount", cell: (t) => fmtMoney(t.amountCents, t.currency), className: "text-right tabular-nums" },
              { header: "Date", cell: (t) => <span className="whitespace-nowrap text-slate-500">{fmtTime(t.capturedAt)}</span> },
              { header: "Refunded", cell: (t) => fmtMoney(t.refundedCents, t.currency), className: "text-right tabular-nums" },
              { header: "Remaining", cell: (t) => fmtMoney(t.remainingCents, t.currency), className: "text-right tabular-nums" },
              { header: "Status", cell: (t) => <Badge tone={REFUND_STATE_TONE[t.refundState]}>{REFUND_STATE_LABEL[t.refundState]}</Badge> },
            ]}
          />
        </>
      )}

      {tab === "history" && (
        <DataTable
          rows={refunds}
          rowHref={(r) => `/apps/refunds/${r.transactionId}`}
          empty="No refunds issued yet."
          columns={[
            { header: "Refund", cell: (r) => `#${r.id}` },
            { header: "Txn", cell: (r) => `#${r.transactionId}` },
            { header: "Customer", cell: (r) => r.customerName },
            { header: "Card", cell: (r) => <span className="font-mono text-xs">{r.cardMasked}</span> },
            { header: "Amount", cell: (r) => fmtMoney(r.amountCents), className: "text-right tabular-nums" },
            { header: "Reason code", cell: (r) => <code className="text-xs">{r.reasonCode}</code> },
            { header: "Status", cell: (r) => <Badge tone="green">{r.status}</Badge> },
            { header: "Issued by", cell: (r) => r.issuedBy },
            { header: "Approved by", cell: (r) => r.approvedBy ?? "—" },
            { header: "Issued", cell: (r) => <span className="whitespace-nowrap text-slate-500">{fmtTime(r.issuedAt)}</span> },
          ]}
        />
      )}

      {tab === "pending" && (
        <DataTable
          rows={pending}
          rowHref={(p) => `/apps/refunds/${p.transactionId}`}
          empty="No refunds are waiting for approval."
          columns={[
            { header: "Request", cell: (p) => `#${p.requestId}` },
            { header: "Txn", cell: (p) => `#${p.transactionId}` },
            { header: "Amount", cell: (p) => fmtMoney(p.amountCents), className: "text-right tabular-nums" },
            { header: "Summary", cell: (p) => <span className="text-xs">{p.summary}</span> },
            { header: "Requested by", cell: (p) => p.requestedBy },
            { header: "Reason", cell: (p) => p.reason },
            { header: "Requested", cell: (p) => <span className="whitespace-nowrap text-slate-500">{fmtTime(p.requestedAt)}</span> },
            { header: "Status", cell: () => <Badge tone="yellow">pending approval</Badge> },
          ]}
        />
      )}
    </>
  );
}
