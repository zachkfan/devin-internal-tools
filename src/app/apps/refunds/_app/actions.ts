"use server";

import { z } from "zod";
import { ActionError, defineAction } from "@/platform/action";
import { db } from "@/platform/db";
import { fmtMoney } from "@/platform/ui/primitives";
import { LARGE_REFUND_CENTS, REASON_CODES } from "./manifest";
import { getTransactionRow, txnTarget } from "./queries";

const toCents = (dollars: number) => Math.round(dollars * 100);

const amount = z.coerce.number().positive("Amount must be greater than zero.")
  .refine((d) => Math.abs(d * 100 - toCents(d)) < 1e-6, "Amount can have at most 2 decimal places.");

/** Loads the transaction and enforces that total refunds never exceed the captured amount. */
function checkRefundable(transactionId: number, cents: number) {
  const t = getTransactionRow(transactionId);
  if (!t) throw new ActionError(`Transaction #${transactionId} not found.`);
  if (t.status !== "captured") throw new ActionError(`Transaction #${transactionId} is ${t.status}; only captured transactions can be refunded.`);
  const remaining = t.amount_cents - t.refunded_cents;
  if (cents > remaining) {
    throw new ActionError(
      `Refund of ${fmtMoney(cents)} exceeds the remaining refundable ${fmtMoney(remaining)} on transaction #${transactionId} (captured ${fmtMoney(t.amount_cents)}, already refunded ${fmtMoney(t.refunded_cents)}).`,
    );
  }
  return t;
}

export const issueRefund = defineAction({
  app: "refunds",
  name: "issue_refund",
  permission: "refunds:issue",
  input: z.object({
    transactionId: z.coerce.number().int().positive(),
    amount,
    reasonCode: z.enum(REASON_CODES),
  }),
  target: (i) => txnTarget(i.transactionId),
  approval: {
    required: ({ transactionId, amount }) => {
      // Fail fast so invalid refunds never reach the approvals inbox. run() re-checks when the approved request executes.
      checkRefundable(transactionId, toCents(amount));
      return toCents(amount) > LARGE_REFUND_CENTS;
    },
    approverPermission: "refunds:approve_large",
    summary: ({ transactionId, amount, reasonCode }) => {
      const t = getTransactionRow(transactionId);
      return `Refund ${fmtMoney(toCents(amount))} on transaction #${transactionId} (${t?.merchant_descriptor}, ${t?.customer_name}), reason: ${reasonCode}`;
    },
  },
  run: ({ transactionId, amount, reasonCode }, ctx) => {
    const cents = toCents(amount);
    const t = checkRefundable(transactionId, cents);
    const res = db().prepare(
      `INSERT INTO refunds_refunds (transaction_id, amount_cents, reason_code, note, status, issued_by, approved_by, issued_at)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?)`,
    ).run(transactionId, cents, reasonCode, ctx.reason, ctx.user.id, ctx.approvedBy?.id ?? null, new Date().toISOString());
    const refundId = Number(res.lastInsertRowid);
    ctx.record({
      refundId,
      before: { refundedCents: t.refunded_cents },
      after: { refundedCents: t.refunded_cents + cents, remainingCents: t.amount_cents - t.refunded_cents - cents },
    });
    return `Refund #${refundId} of ${fmtMoney(cents)} issued on transaction #${transactionId}${ctx.approvedBy ? ` (second approval by ${ctx.approvedBy.name})` : ""}.`;
  },
});
