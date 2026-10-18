import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { ApprovalStatus, AuditTrail } from "@/platform/ui/AuditTrail";
import { Badge, Card, KeyValue, PageHeader, fmtTime } from "@/platform/ui/primitives";
import { RevealField } from "@/platform/ui/RevealField";
import { claimCase, decideCase, revealPii } from "../_app/actions";
import { manifest } from "../_app/manifest";
import { getCase } from "../_app/queries";
import { RISK_TONE, STATUS_TONE } from "../_app/tones";

export default async function KycCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const c = getCase(Number((await params).id));
  if (!c) notFound();
  const target = `kyc_case:${c.id}`;
  const canDecide = can(user, "kyc:decide");
  const canReveal = can(user, "kyc:reveal_pii");
  const pii = (field: "ssn" | "dob" | "email", masked: string) => (
    <RevealField masked={masked} action={revealPii} hidden={{ caseId: c.id, field }} canReveal={canReveal} />
  );
  const open = !["approved", "rejected"].includes(c.status);

  return (
    <>
      <Link href="/apps/kyc" className="text-sm text-blue-700 hover:underline">← Back to queue</Link>
      <PageHeader title={`Case #${c.id}: ${c.customerName}`} actions={<Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ")}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Customer" className="lg:col-span-2">
          <KeyValue items={[
            ["Name", c.customerName],
            ["Email", pii("email", c.emailMasked)],
            ["SSN", pii("ssn", c.ssnMasked)],
            ["Date of birth", pii("dob", c.dobMasked)],
            ["Country", c.country],
            ["Risk", <Badge key="r" tone={RISK_TONE[c.risk]}>{c.risk} · {c.riskScore}</Badge>],
            ["Flags", c.flags.length ? c.flags.join("; ") : "None"],
            ["Submitted", fmtTime(c.submittedAt)],
            ["Assignee", c.assignedTo ?? "Unassigned"],
            ...(c.decidedBy ? ([["Decided", `${c.decidedBy} · ${fmtTime(c.decidedAt)} · "${c.decisionNote}"`]] as [string, string][]) : []),
          ]} />
        </Card>
        <Card title="Decision">
          {!canDecide ? (
            <p className="text-sm text-slate-500">Read-only: you don&apos;t have kyc:decide.</p>
          ) : !open ? (
            <p className="text-sm text-slate-500">This case is closed.</p>
          ) : (
            <div className="space-y-4">
              {c.status !== "in_review" && (
                <ActionForm action={claimCase} hidden={{ caseId: c.id }} reason={false} submits={[{ label: "Claim case", tone: "neutral" }]} />
              )}
              <ActionForm
                action={decideCase}
                hidden={{ caseId: c.id }}
                submits={[
                  { label: "Approve", name: "decision", value: "approve" },
                  { label: "Reject", name: "decision", value: "reject", tone: "danger" },
                  { label: "Escalate", name: "decision", value: "escalate", tone: "neutral" },
                ]}
              />
              {c.risk === "high" && <p className="text-xs text-amber-700">High risk: approval requires a second Ops Manager.</p>}
            </div>
          )}
          <div className="mt-4"><ApprovalStatus target={target} /></div>
        </Card>
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
      <AuditTrail target={target} />
    </>
  );
}
