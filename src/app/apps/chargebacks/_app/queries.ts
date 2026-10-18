import { db } from "@/platform/db";
import { mask } from "@/platform/pii";
import { CONTEST_APPROVAL_THRESHOLD_CENTS, URGENT_DAYS } from "./manifest";

export const STATUSES = ["open", "accepted", "contested"] as const;
export type DisputeStatus = (typeof STATUSES)[number];
export type Network = "visa" | "mastercard" | "amex" | "discover";
export type ReasonCategory = "fraud" | "product_not_received" | "duplicate" | "not_as_described" | "credit_not_processed" | "subscription_canceled";

export const NETWORK_LABEL: Record<Network, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };
export const REASON_LABEL: Record<ReasonCategory, string> = {
  fraud: "Fraud",
  product_not_received: "Product not received",
  duplicate: "Duplicate charge",
  not_as_described: "Not as described",
  credit_not_processed: "Credit not processed",
  subscription_canceled: "Subscription canceled",
};

/** What pages get. Card numbers are masked here; we only ever store the last 4 digits. */
export type Dispute = {
  id: number; network: Network; reasonCode: string; reasonCategory: ReasonCategory; cardholderName: string; cardMasked: string;
  amountCents: number; currency: string; merchantRef: string; transactionDate: string; openedAt: string; respondBy: string;
  daysLeft: number; urgent: boolean; contestNeedsApproval: boolean; status: DisputeStatus; refundedCents: number;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; evidenceCount: number;
};

export type Evidence = { id: number; authorId: string; authorName: string; note: string; createdAt: string };

type Row = {
  id: number; network: Network; reason_code: string; reason_category: ReasonCategory; cardholder_name: string; card_last4: string;
  amount_cents: number; currency: string; merchant_ref: string; transaction_date: string; opened_at: string; respond_by: string;
  status: DisputeStatus; refunded_cents: number; decided_by: string | null; decided_at: string | null; decision_note: string | null;
};

/** Whole days from today (UTC) until the respond-by date. 0 = due today, negative = deadline passed. */
export function daysLeft(respondBy: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${respondBy}T00:00:00Z`) - today) / 86_400_000);
}

export const needsContestApproval = (amountCents: number) => amountCents > CONTEST_APPROVAL_THRESHOLD_CENTS;

const SELECT = `SELECT d.*, (SELECT COUNT(*) FROM chargebacks_evidence e WHERE e.dispute_id = d.id) AS evidence_count FROM chargebacks_disputes d`;

const toDispute = (r: Row & { evidence_count: number }): Dispute => {
  const left = daysLeft(r.respond_by);
  return {
    id: r.id, network: r.network, reasonCode: r.reason_code, reasonCategory: r.reason_category, cardholderName: r.cardholder_name,
    cardMasked: mask(r.card_last4, "card"), amountCents: r.amount_cents, currency: r.currency, merchantRef: r.merchant_ref,
    transactionDate: r.transaction_date, openedAt: r.opened_at, respondBy: r.respond_by, daysLeft: left,
    urgent: r.status === "open" && left < URGENT_DAYS, contestNeedsApproval: needsContestApproval(r.amount_cents), status: r.status,
    refundedCents: r.refunded_cents, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, evidenceCount: r.evidence_count,
  };
};

const DISPUTE_ORDER = {
  deadline_asc: "d.respond_by ASC, d.amount_cents DESC, d.id ASC",
  deadline_desc: "d.respond_by DESC, d.amount_cents DESC, d.id DESC",
  amount_desc: "d.amount_cents DESC, d.respond_by ASC",
  amount_asc: "d.amount_cents ASC, d.respond_by ASC",
  opened_desc: "d.opened_at DESC, d.id DESC",
  opened_asc: "d.opened_at ASC, d.id ASC",
} as const;
export type DisputeSort = keyof typeof DISPUTE_ORDER;
export const DISPUTE_SORTS = Object.keys(DISPUTE_ORDER) as DisputeSort[];

/** Search by cardholder, merchant ref, reason code, card last 4 or dispute id; optionally filter by status and sort (default: soonest deadline first). */
export function listDisputes(q = "", opts: { status?: DisputeStatus; sort?: DisputeSort } = {}): Dispute[] {
  const term = q.trim();
  const order = DISPUTE_ORDER[opts.sort ?? "deadline_asc"] ?? DISPUTE_ORDER.deadline_asc;
  const where = [
    ...(opts.status ? ["d.status = :status"] : []),
    ...(term
      ? [`(d.cardholder_name LIKE :like ESCAPE '\\' OR d.merchant_ref LIKE :like ESCAPE '\\' OR d.reason_code LIKE :like ESCAPE '\\'
          OR d.card_last4 = :term OR CAST(d.id AS TEXT) = :term)`]
      : []),
  ];
  const params = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(term ? { like: `%${term.replace(/[\\%_]/g, "\\$&")}%`, term } : {}),
  };
  const rows = db()
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}`)
    .all(params) as (Row & { evidence_count: number })[];
  return rows.map(toDispute);
}

export function getDispute(id: number): Dispute | null {
  const row = db().prepare(`${SELECT} WHERE d.id = ?`).get(id) as (Row & { evidence_count: number }) | undefined;
  return row ? toDispute(row) : null;
}

export function listEvidence(disputeId: number): Evidence[] {
  return db()
    .prepare(
      `SELECT e.id, e.author_id AS authorId, COALESCE(u.name, e.author_id) AS authorName, e.note, e.created_at AS createdAt
       FROM chargebacks_evidence e LEFT JOIN users u ON u.id = e.author_id WHERE e.dispute_id = ? ORDER BY e.id`,
    )
    .all(disputeId) as Evidence[];
}

/** Raw row for use inside actions only. Never return this to a page. */
export function getDisputeRow(id: number): Row | undefined {
  return db().prepare("SELECT * FROM chargebacks_disputes WHERE id = ?").get(id) as Row | undefined;
}

export function evidenceCount(disputeId: number): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM chargebacks_evidence WHERE dispute_id = ?").get(disputeId) as { n: number }).n;
}
