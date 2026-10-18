import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { ApprovalStatus, AuditTrail } from "@/platform/ui/AuditTrail";
import { Badge, Card, DataTable, KeyValue, PageHeader, fmtMoney, fmtTime } from "@/platform/ui/primitives";
import { issueRefund } from "../_app/actions";
import { LARGE_REFUND_CENTS, manifest, REASON_CODES } from "../_app/manifest";
import { getTransaction, listRefunds, txnTarget } from "../_app/queries";
import { REFUND_STATE_LABEL, REFUND_STATE_TONE } from "../_app/tones";

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const t = getTransaction(Number((await params).id));
  if (!t) notFound();
  const target = txnTarget(t.id);
  const refunds = listRefunds(t.id);
  const canIssue = can(user, "refunds:issue");

  return (
    <>
      <Link href="/apps/refunds" className="text-sm text-blue-700 hover:underline">← Back to transactions</Link>
      <PageHeader title={`Transaction #${t.id}: ${t.merchant}`}
        actions={<Badge tone={REFUND_STATE_TONE[t.refundState]}>{REFUND_STATE_LABEL[t.refundState]}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Transaction" className="lg:col-span-2">
          <KeyValue items={[
            ["Customer", t.customerName],
            ["Card", <span key="c" className="font-mono">{t.cardBrand} {t.cardMasked}</span>],
            ["Merchant descriptor", <span key="m" className="font-mono">{t.merchant}</span>],
            ["Captured", `${fmtMoney(t.amountCents, t.currency)} · ${fmtTime(t.capturedAt)}`],
            ["Refunded so far", fmtMoney(t.refundedCents, t.currency)],
            ["Remaining refundable", <b key="r">{fmtMoney(t.remainingCents, t.currency)}</b>],
          ]} />
        </Card>
        <Card title="Issue refund">
          {!canIssue ? (
            <p className="text-sm text-slate-500">Read-only: you don&apos;t have refunds:issue.</p>
          ) : t.remainingCents === 0 ? (
            <p className="text-sm text-slate-500">This transaction is fully refunded.</p>
          ) : (
            <div className="space-y-2">
              <ActionForm
                action={issueRefund}
                hidden={{ transactionId: t.id }}
                fields={[
                  { name: "amount", label: `Amount (USD, max ${fmtMoney(t.remainingCents, t.currency)})`, type: "number", placeholder: (t.remainingCents / 100).toFixed(2) },
                  { name: "reasonCode", label: "Reason code", type: "select", options: REASON_CODES.map((c) => ({ value: c, label: c.replaceAll("_", " ") })) },
                ]}
                submits={[{ label: "Issue refund" }]}
              />
              <p className="text-xs text-amber-700">Refunds over {fmtMoney(LARGE_REFUND_CENTS)} need a second Ops Manager to approve.</p>
            </div>
          )}
          <div className="mt-4"><ApprovalStatus target={target} /></div>
        </Card>
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Refunds issued</h2>
      <DataTable
        rows={refunds}
        empty="No refunds issued against this transaction."
        columns={[
          { header: "Refund", cell: (r) => `#${r.id}` },
          { header: "Amount", cell: (r) => fmtMoney(r.amountCents), className: "text-right tabular-nums" },
          { header: "Reason code", cell: (r) => <code className="text-xs">{r.reasonCode}</code> },
          { header: "Note", cell: (r) => r.note },
          { header: "Status", cell: (r) => <Badge tone="green">{r.status}</Badge> },
          { header: "Issued by", cell: (r) => r.issuedBy },
          { header: "Approved by", cell: (r) => r.approvedBy ?? "—" },
          { header: "Issued", cell: (r) => <span className="whitespace-nowrap text-slate-500">{fmtTime(r.issuedAt)}</span> },
        ]}
      />
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
      <AuditTrail target={target} />
    </>
  );
}
