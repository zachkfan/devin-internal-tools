import { approvalsForTarget } from "@/platform/approvals";
import { db } from "@/platform/db";
import { mask } from "@/platform/pii";
import type { ReasonCode } from "./manifest";

export const txnTarget = (id: number) => `refunds_txn:${id}`;

export type RefundState = "none" | "partial" | "full";

/** What pages get. Only a masked card (last 4) ever leaves this module. */
export type Transaction = {
  id: number; customerName: string; cardBrand: string; cardMasked: string; merchant: string;
  amountCents: number; currency: string; capturedAt: string;
  refundedCents: number; remainingCents: number; refundState: RefundState;
};

export type Refund = {
  id: number; transactionId: number; customerName: string; cardMasked: string; merchant: string;
  amountCents: number; reasonCode: ReasonCode; note: string; status: "issued";
  issuedBy: string; approvedBy: string | null; issuedAt: string;
};

export type PendingRefund = {
  requestId: number; transactionId: number; amountCents: number; summary: string;
  requestedBy: string; requestedAt: string; reason: string;
};

type TxnRow = {
  id: number; customer_name: string; card_brand: string; card_last4: string; merchant_descriptor: string;
  amount_cents: number; currency: string; status: "captured"; captured_at: string; refunded_cents: number;
};

type RefundRow = {
  id: number; transaction_id: number; customer_name: string; card_last4: string; merchant_descriptor: string;
  amount_cents: number; reason_code: ReasonCode; note: string; status: "issued";
  issued_by: string; approved_by: string | null; issued_at: string;
};

const TXN_SELECT = `
  SELECT t.*, COALESCE((SELECT SUM(r.amount_cents) FROM refunds_refunds r WHERE r.transaction_id = t.id), 0) AS refunded_cents
  FROM refunds_transactions t`;

const toTxn = (r: TxnRow): Transaction => {
  const remaining = r.amount_cents - r.refunded_cents;
  return {
    id: r.id, customerName: r.customer_name, cardBrand: r.card_brand, cardMasked: mask(r.card_last4, "card"),
    merchant: r.merchant_descriptor, amountCents: r.amount_cents, currency: r.currency, capturedAt: r.captured_at,
    refundedCents: r.refunded_cents, remainingCents: remaining,
    refundState: r.refunded_cents === 0 ? "none" : remaining === 0 ? "full" : "partial",
  };
};

const toRefund = (r: RefundRow): Refund => ({
  id: r.id, transactionId: r.transaction_id, customerName: r.customer_name, cardMasked: mask(r.card_last4, "card"),
  merchant: r.merchant_descriptor, amountCents: r.amount_cents, reasonCode: r.reason_code, note: r.note, status: r.status,
  issuedBy: r.issued_by, approvedBy: r.approved_by, issuedAt: r.issued_at,
});

/** Search by customer name, merchant descriptor, card last 4 or transaction id. */
export function listTransactions(q = ""): Transaction[] {
  const term = q.trim();
  const rows = term
    ? db().prepare(`${TXN_SELECT}
        WHERE t.customer_name LIKE :like OR t.merchant_descriptor LIKE :like OR t.card_last4 = :term OR CAST(t.id AS TEXT) = :term
        ORDER BY t.captured_at DESC`).all({ like: `%${term}%`, term })
    : db().prepare(`${TXN_SELECT} ORDER BY t.captured_at DESC`).all();
  return (rows as TxnRow[]).map(toTxn);
}

export function getTransaction(id: number): Transaction | null {
  const row = getTransactionRow(id);
  return row ? toTxn(row) : null;
}

export function listRefunds(transactionId?: number): Refund[] {
  const sql = `
    SELECT r.*, t.customer_name, t.card_last4, t.merchant_descriptor
    FROM refunds_refunds r JOIN refunds_transactions t ON t.id = r.transaction_id
    ${transactionId === undefined ? "" : "WHERE r.transaction_id = ?"}
    ORDER BY r.issued_at DESC, r.id DESC`;
  const rows = transactionId === undefined ? db().prepare(sql).all() : db().prepare(sql).all(transactionId);
  return (rows as RefundRow[]).map(toRefund);
}

/** Refund requests over the threshold that are waiting in the shared approvals inbox. */
export function listPendingRefunds(): PendingRefund[] {
  const ids = (db().prepare("SELECT id FROM refunds_transactions").all() as { id: number }[]).map((r) => r.id);
  return ids
    .flatMap((id) => approvalsForTarget(txnTarget(id)))
    .filter((r) => r.app === "refunds" && r.action === "issue_refund" && r.status === "pending")
    .map((r) => {
      const payload = JSON.parse(r.payload) as { transactionId: number; amount: number };
      return {
        requestId: r.id, transactionId: payload.transactionId, amountCents: Math.round(payload.amount * 100), summary: r.summary,
        requestedBy: r.requested_by, requestedAt: r.requested_at, reason: r.request_reason,
      };
    })
    .sort((a, b) => b.requestId - a.requestId);
}

export type RefundStats = {
  refunded7dCents: number; refunds7dCount: number; pendingApprovals: number;
  refundedCents: number; capturedCents: number; refundRate: number;
};

export function refundStats(now = Date.now()): RefundStats {
  const since = new Date(now - 7 * 24 * 3600_000).toISOString();
  const recent = db().prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS n FROM refunds_refunds WHERE issued_at >= ?")
    .get(since) as { cents: number; n: number };
  const totals = db().prepare(`
    SELECT (SELECT COALESCE(SUM(amount_cents), 0) FROM refunds_refunds) AS refunded,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM refunds_transactions) AS captured`).get() as { refunded: number; captured: number };
  return {
    refunded7dCents: recent.cents, refunds7dCount: recent.n, pendingApprovals: listPendingRefunds().length,
    refundedCents: totals.refunded, capturedCents: totals.captured,
    refundRate: totals.captured === 0 ? 0 : totals.refunded / totals.captured,
  };
}

/** Raw row (incl. refunded total) for use inside actions only. Never return this to a page. */
export function getTransactionRow(id: number): TxnRow | undefined {
  return db().prepare(`${TXN_SELECT} WHERE t.id = ?`).get(id) as TxnRow | undefined;
}
