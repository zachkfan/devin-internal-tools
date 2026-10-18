import Link from "next/link";
import { notFound } from "next/navigation";
import { approvalsForTarget } from "@/platform/approvals";
import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { ApprovalStatus, AuditTrail } from "@/platform/ui/AuditTrail";
import { Badge, Card, KeyValue, PageHeader, fmtMoney, fmtTime } from "@/platform/ui/primitives";
import { acceptDispute, addEvidence, contestDispute } from "../_app/actions";
import { manifest } from "../_app/manifest";
import { NETWORK_LABEL, REASON_LABEL, getDispute, listEvidence } from "../_app/queries";
import { REASON_TONE, STATUS_TONE, daysLeftLabel } from "../_app/tones";

export default async function ChargebackDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const d = getDispute(Number((await params).id));
  if (!d) notFound();
  const target = `chargeback:${d.id}`;
  const evidence = listEvidence(d.id);
  const open = d.status === "open";
  const pendingRequest = approvalsForTarget(target).some((r) => r.status === "pending");
  const canAddEvidence = can(user, "chargebacks:add_evidence");
  const canAccept = can(user, "chargebacks:accept");
  const canContest = can(user, "chargebacks:contest");
  const amount = fmtMoney(d.amountCents, d.currency);

  return (
    <>
      <Link href="/apps/chargebacks" className="text-sm text-blue-700 hover:underline">← Back to queue</Link>
      <PageHeader
        title={`Dispute #${d.id}: ${amount} ${REASON_LABEL[d.reasonCategory].toLowerCase()}`}
        actions={<Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dispute" className="lg:col-span-2">
          <KeyValue items={[
            ["Respond by", (
              <span key="rb" className="inline-flex items-center gap-2">
                {d.respondBy}
                {open && <Badge tone={d.urgent ? "red" : "green"}>{daysLeftLabel(d.daysLeft)}</Badge>}
              </span>
            )],
            ["Amount", amount],
            ["Reason", <span key="r"><Badge tone={REASON_TONE[d.reasonCategory]}>{REASON_LABEL[d.reasonCategory]}</Badge> <code className="text-xs">{NETWORK_LABEL[d.network]} {d.reasonCode}</code></span>],
            ["Cardholder", d.cardholderName],
            ["Card", <span key="c" className="font-mono">{NETWORK_LABEL[d.network]} {d.cardMasked}</span>],
            ["Merchant ref", <code key="m" className="text-xs">{d.merchantRef}</code>],
            ["Transaction date", d.transactionDate],
            ["Opened", fmtTime(d.openedAt)],
            ...(d.decidedBy
              ? ([
                  ["Decided", `${d.status} by ${d.decidedBy} · ${fmtTime(d.decidedAt)} · "${d.decisionNote}"`],
                  ...(d.refundedCents ? [["Refunded", fmtMoney(d.refundedCents, d.currency)]] : []),
                ] as [string, string][])
              : []),
          ]} />
        </Card>
        <Card title="Decision">
          {!canAccept && !canContest ? (
            <p className="text-sm text-slate-500">Read-only: you can view this dispute but not decide it.</p>
          ) : !open ? (
            <p className="text-sm text-slate-500">This dispute is closed ({d.status}).</p>
          ) : pendingRequest ? (
            <p className="text-sm text-amber-700">A contest request is waiting for a second approver.</p>
          ) : evidence.length === 0 ? (
            <p className="text-sm text-amber-700">Add a written evidence note before accepting or contesting.</p>
          ) : (
            <div className="space-y-4">
              {canAccept && (
                <div>
                  <p className="mb-2 text-xs text-slate-500">Accept: refund {amount} to the customer.</p>
                  <ActionForm action={acceptDispute} hidden={{ disputeId: d.id }} submits={[{ label: "Accept & refund", tone: "danger" }]} />
                </div>
              )}
              {canContest && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs text-slate-500">Contest: submit our evidence to {NETWORK_LABEL[d.network]}.</p>
                  {d.daysLeft < 0 ? (
                    <p className="text-sm text-red-700">The respond-by date has passed; this dispute can no longer be contested.</p>
                  ) : (
                    <ActionForm action={contestDispute} hidden={{ disputeId: d.id }} submits={[{ label: "Contest" }]} />
                  )}
                  {d.contestNeedsApproval && <p className="mt-2 text-xs text-amber-700">Over $1,000: contesting requires an Ops Manager&apos;s approval.</p>}
                </div>
              )}
            </div>
          )}
          <div className="mt-4"><ApprovalStatus target={target} /></div>
        </Card>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Evidence ({evidence.length})</h2>
      <Card>
        {evidence.length === 0 ? (
          <p className="text-sm text-slate-500">No evidence notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {evidence.map((e) => (
              <li key={e.id} className="text-sm">
                <div className="text-xs text-slate-500">{e.authorName} · {fmtTime(e.createdAt)}</div>
                <p className="whitespace-pre-wrap text-slate-900">{e.note}</p>
              </li>
            ))}
          </ul>
        )}
        {open && canAddEvidence && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ActionForm
              action={addEvidence}
              hidden={{ disputeId: d.id }}
              reason={false}
              fields={[{ name: "note", label: "Evidence note", type: "textarea", placeholder: "e.g. AVS/CVV matched, signed proof of delivery, refund already issued..." }]}
              submits={[{ label: "Add evidence note", tone: "neutral" }]}
            />
          </div>
        )}
      </Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
      <AuditTrail target={target} />
    </>
  );
}
