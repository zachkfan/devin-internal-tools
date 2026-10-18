import { defineApp } from "@/platform/app";

/** Contesting a dispute strictly over this amount needs a second approver (Ops Manager). */
export const CONTEST_APPROVAL_THRESHOLD_CENTS = 100_000;
/** Open disputes with fewer days left than this are shown in red. */
export const URGENT_DAYS = 3;

export const manifest = defineApp({
  id: "chargebacks",
  name: "Chargeback Disputes",
  description:
    "Work card-network chargebacks by respond-by deadline: add a written evidence note, then accept (refund the customer) or contest. Contesting a dispute over $1,000 needs an Ops Manager's approval.",
  readPermission: "chargebacks:read",
  permissions: {
    "chargebacks:read": { description: "View the dispute queue, evidence and history (card numbers masked)", roles: ["support_agent", "ops_manager", "compliance"] },
    "chargebacks:add_evidence": { description: "Add written evidence notes to open disputes", roles: ["support_agent", "ops_manager"] },
    "chargebacks:accept": { description: "Accept a chargeback and refund the customer", roles: ["support_agent", "ops_manager"] },
    "chargebacks:contest": { description: "Contest a chargeback with the card network", roles: ["support_agent", "ops_manager"] },
    "chargebacks:approve_contest": { description: "Second approver for contesting disputes over $1,000", roles: ["ops_manager"] },
  },
  schema: `
    CREATE TABLE IF NOT EXISTS chargebacks_disputes (
      id INTEGER PRIMARY KEY,
      network TEXT NOT NULL CHECK (network IN ('visa','mastercard','amex','discover')),
      reason_code TEXT NOT NULL,
      reason_category TEXT NOT NULL CHECK (reason_category IN ('fraud','product_not_received','duplicate','not_as_described','credit_not_processed','subscription_canceled')),
      cardholder_name TEXT NOT NULL,
      card_last4 TEXT NOT NULL CHECK (length(card_last4) = 4),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      merchant_ref TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      respond_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','contested')),
      refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
      decided_by TEXT REFERENCES users(id),
      decided_at TEXT,
      decision_note TEXT
    );
    CREATE TABLE IF NOT EXISTS chargebacks_evidence (
      id INTEGER PRIMARY KEY,
      dispute_id INTEGER NOT NULL REFERENCES chargebacks_disputes(id),
      author_id TEXT NOT NULL REFERENCES users(id),
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
  seed(conn) {
    // Synthetic data only. We never store full card numbers (PANs), just the last 4 digits.
    type Seed = [network: string, code: string, category: string, cardholder: string, last4: string, cents: number, daysLeft: number, status: string, evidence: string[]];
    const disputes: Seed[] = [
      ["visa", "10.4", "fraud", "Maya Thompson", "4821", 184_250, 1, "open", ["Order shipped to billing address; AVS and CVV matched. Device seen on 4 prior undisputed orders."]],
      ["mastercard", "4855", "product_not_received", "Liam O'Connor", "5107", 8_999, 2, "open", []],
      ["visa", "12.6.1", "duplicate", "Chen Wei", "4033", 24_900, 0, "open", []],
      ["amex", "F29", "fraud", "Fatima Al-Sayed", "3782", 312_000, 6, "open", []],
      ["visa", "13.3", "not_as_described", "Diego Fernández", "4556", 41_275, 9, "open", []],
      ["mastercard", "4853", "credit_not_processed", "Grace Kim", "5520", 100_000, 4, "open", []],
      ["visa", "13.2", "subscription_canceled", "Oluwaseun Adeyemi", "4917", 1_499, 12, "open", []],
      ["mastercard", "4837", "fraud", "Sofia Rossi", "5399", 100_001, 5, "open", []],
      ["discover", "4553", "not_as_described", "Noah Becker", "6011", 6_420, -1, "open", []],
      ["mastercard", "4834", "duplicate", "Aisha Khan", "5232", 3_950, 15, "open", ["Two authorizations but only one settled; second auth was reversed on the same day."]],
      ["amex", "C08", "product_not_received", "Lucas Martin", "3714", 53_000, 8, "accepted", ["Carrier shows package lost in transit; no proof of delivery."]],
      ["visa", "10.4", "fraud", "Emily Davis", "4716", 245_000, 3, "contested", ["3DS authenticated; signed delivery confirmation attached from carrier."]],
    ];
    const day = 86_400_000;
    const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
    const insert = conn.prepare(
      `INSERT INTO chargebacks_disputes (network, reason_code, reason_category, cardholder_name, card_last4, amount_cents, merchant_ref,
         transaction_date, opened_at, respond_by, status, refunded_cents, decided_by, decided_at, decision_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const addEvidence = conn.prepare("INSERT INTO chargebacks_evidence (dispute_id, author_id, note, created_at) VALUES (?, ?, ?, ?)");
    disputes.forEach(([network, code, category, cardholder, last4, cents, daysLeft, status, evidence], i) => {
      const openedAt = new Date(Date.now() - (30 - daysLeft) * day + i * 3_600_000).toISOString();
      const closed = status !== "open";
      const res = insert.run(
        network, code, category, cardholder, last4, cents, `ORD-${58_210 + i * 37}`, isoDate(daysLeft - 45), openedAt, isoDate(daysLeft), status,
        status === "accepted" ? cents : 0, closed ? "omar" : null, closed ? new Date(Date.now() - 2 * day).toISOString() : null,
        closed ? (status === "accepted" ? "No proof of delivery; refund the customer." : "Strong 3DS + delivery evidence.") : null,
      );
      for (const note of evidence) addEvidence.run(Number(res.lastInsertRowid), i % 2 ? "omar" : "sam", note, new Date(Date.now() - 3 * day).toISOString());
    });
  },
});
