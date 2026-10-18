"use server";

import { z } from "zod";
import { ActionError, defineAction } from "@/platform/action";
import { approvalsForTarget } from "@/platform/approvals";
import { db } from "@/platform/db";
import { fmtMoney } from "@/platform/ui/primitives";
import { NETWORK_LABEL, REASON_LABEL, daysLeft, evidenceCount, getDisputeRow, needsContestApproval } from "./queries";

const disputeId = z.coerce.number().int().positive();

/** Shared invariants for accept/contest. Re-checked at execution time, because approved requests run later against current data. */
function loadOpenDispute(id: number) {
  const d = getDisputeRow(id);
  if (!d) throw new ActionError(`Dispute #${id} not found.`);
  if (d.status !== "open") throw new ActionError(`Dispute #${id} is already ${d.status}.`);
  if (evidenceCount(id) === 0) throw new ActionError(`Add a written evidence note to dispute #${id} before deciding it.`);
  return d;
}

function loadContestableDispute(id: number) {
  const d = loadOpenDispute(id);
  if (daysLeft(d.respond_by) < 0) throw new ActionError(`Dispute #${id} passed its respond-by date (${d.respond_by}); it can no longer be contested.`);
  return d;
}

export const addEvidence = defineAction({
  app: "chargebacks",
  name: "add_evidence",
  permission: "chargebacks:add_evidence",
  requireReason: false,
  // Check the dispute during validation: failures there aren't audited, while run() errors audit the full input (incl. note text).
  input: z
    .object({ disputeId, note: z.string().trim().min(10, "Evidence note must be at least 10 characters.").max(4000) })
    .superRefine(({ disputeId }, issue) => {
      const d = getDisputeRow(disputeId);
      if (!d) issue.addIssue({ code: "custom", path: ["disputeId"], message: `Dispute #${disputeId} not found.` });
      else if (d.status !== "open") issue.addIssue({ code: "custom", path: ["disputeId"], message: `Dispute #${disputeId} is ${d.status}; evidence can only be added to open disputes.` });
    }),
  target: (i) => `chargeback:${i.disputeId}`,
  run: ({ disputeId, note }, ctx) => {
    const d = getDisputeRow(disputeId);
    if (!d) throw new ActionError(`Dispute #${disputeId} not found.`);
    if (d.status !== "open") throw new ActionError(`Dispute #${disputeId} is ${d.status}; evidence can only be added to open disputes.`);
    const res = db()
      .prepare("INSERT INTO chargebacks_evidence (dispute_id, author_id, note, created_at) VALUES (?, ?, ?, ?)")
      .run(disputeId, ctx.user.id, note, new Date().toISOString());
    // Free-text notes may contain customer details: audit the fact and size of the note, not its text.
    ctx.record({ input: { disputeId }, evidenceId: Number(res.lastInsertRowid), noteLength: note.length });
    return `Evidence note added to dispute #${disputeId}.`;
  },
});

export const acceptDispute = defineAction({
  app: "chargebacks",
  name: "accept_dispute",
  permission: "chargebacks:accept",
  input: z.object({ disputeId }),
  target: (i) => `chargeback:${i.disputeId}`,
  run: ({ disputeId }, ctx) => {
    const d = loadOpenDispute(disputeId);
    db().prepare("UPDATE chargebacks_disputes SET status = 'accepted', refunded_cents = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
      .run(d.amount_cents, ctx.user.id, new Date().toISOString(), ctx.reason, disputeId);
    ctx.record({ before: { status: d.status, refundedCents: d.refunded_cents }, after: { status: "accepted", refundedCents: d.amount_cents } });
    return `Dispute #${disputeId} accepted: ${fmtMoney(d.amount_cents, d.currency)} refunded to the customer.`;
  },
});

export const contestDispute = defineAction({
  app: "chargebacks",
  name: "contest_dispute",
  permission: "chargebacks:contest",
  input: z.object({ disputeId }),
  target: (i) => `chargeback:${i.disputeId}`,
  approval: {
    // Validate before queueing so the inbox never holds a request that can't execute; run() re-checks at approval time.
    required: ({ disputeId }) => {
      const d = loadContestableDispute(disputeId);
      if (approvalsForTarget(`chargeback:${disputeId}`).some((r) => r.action === "contest_dispute" && r.status === "pending")) {
        throw new ActionError(`A contest request for dispute #${disputeId} is already waiting for approval.`);
      }
      return needsContestApproval(d.amount_cents);
    },
    approverPermission: "chargebacks:approve_contest",
    summary: ({ disputeId }) => {
      const d = getDisputeRow(disputeId);
      if (!d) return `Contest chargeback #${disputeId}`;
      return `Contest chargeback #${disputeId}: ${fmtMoney(d.amount_cents, d.currency)} ${NETWORK_LABEL[d.network]} ${d.reason_code} (${REASON_LABEL[d.reason_category]}), respond by ${d.respond_by}`;
    },
  },
  run: ({ disputeId }, ctx) => {
    const d = loadContestableDispute(disputeId);
    db().prepare("UPDATE chargebacks_disputes SET status = 'contested', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
      .run(ctx.user.id, new Date().toISOString(), ctx.reason, disputeId);
    ctx.record({ before: { status: d.status }, after: { status: "contested" }, amountCents: d.amount_cents });
    return `Dispute #${disputeId} contested${ctx.approvedBy ? ` (second approval by ${ctx.approvedBy.name})` : ""}.`;
  },
});
