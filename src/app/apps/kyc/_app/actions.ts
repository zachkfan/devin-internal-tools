"use server";

import { z } from "zod";
import { ActionError, defineAction } from "@/platform/action";
import { db } from "@/platform/db";
import { HIGH_RISK_SCORE } from "./manifest";
import { getCaseRow } from "./queries";

const caseId = z.coerce.number().int().positive();

function loadCase(id: number) {
  const row = getCaseRow(id);
  if (!row) throw new ActionError(`Case #${id} not found.`);
  return row;
}

export const claimCase = defineAction({
  app: "kyc",
  name: "claim_case",
  permission: "kyc:decide",
  requireReason: false,
  input: z.object({ caseId }),
  target: (i) => `kyc_case:${i.caseId}`,
  run: ({ caseId }, ctx) => {
    const c = loadCase(caseId);
    if (!["pending", "escalated"].includes(c.status)) throw new ActionError(`Case is ${c.status}; only pending or escalated cases can be claimed.`);
    db().prepare("UPDATE kyc_cases SET status = 'in_review', assigned_to = ? WHERE id = ?").run(ctx.user.id, caseId);
    ctx.record({ before: { status: c.status, assignedTo: c.assigned_to } });
    return `Case #${caseId} is now assigned to you.`;
  },
});

export const decideCase = defineAction({
  app: "kyc",
  name: "decide_case",
  permission: "kyc:decide",
  input: z.object({ caseId, decision: z.enum(["approve", "reject", "escalate"]) }),
  target: (i) => `kyc_case:${i.caseId}`,
  approval: {
    required: ({ caseId, decision }) => decision === "approve" && (getCaseRow(caseId)?.risk_score ?? 0) >= HIGH_RISK_SCORE,
    approverPermission: "kyc:approve_high_risk",
    summary: ({ caseId }) => {
      const c = getCaseRow(caseId);
      return `Approve high-risk KYC case #${caseId} (${c?.customer_name}, risk ${c?.risk_score})`;
    },
  },
  run: ({ caseId, decision }, ctx) => {
    const c = loadCase(caseId);
    if (["approved", "rejected"].includes(c.status)) throw new ActionError(`Case #${caseId} is already ${c.status}.`);
    const status = { approve: "approved", reject: "rejected", escalate: "escalated" }[decision];
    const final = decision !== "escalate";
    db().prepare("UPDATE kyc_cases SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, assigned_to = ? WHERE id = ?")
      .run(status, final ? ctx.user.id : null, final ? new Date().toISOString() : null, ctx.reason, final ? c.assigned_to : null, caseId);
    ctx.record({ before: { status: c.status }, after: { status } });
    return `Case #${caseId} ${status}${ctx.approvedBy ? ` (second approval by ${ctx.approvedBy.name})` : ""}.`;
  },
});

export const revealPii = defineAction({
  app: "kyc",
  name: "reveal_pii",
  permission: "kyc:reveal_pii",
  input: z.object({ caseId, field: z.enum(["ssn", "dob", "email"]) }),
  target: (i) => `kyc_case:${i.caseId}`,
  run: ({ caseId, field }, ctx) => {
    const c = loadCase(caseId);
    ctx.record({ field });
    return { value: c[field] };
  },
});
