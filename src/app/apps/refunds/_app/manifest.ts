import { defineApp } from "@/platform/app";

/** Refunds strictly over this amount (in cents) need a second approver. $500.00 itself executes immediately. */
export const LARGE_REFUND_CENTS = 50_000;

export const REASON_CODES = ["duplicate", "fraud", "product_not_received", "goodwill", "other"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const manifest = defineApp({
  id: "refunds",
  name: "Refunds Dashboard",
  description:
    "Issue full or partial refunds against customer card transactions. Refunds over $500 need a second Ops Manager; total refunds can never exceed the captured amount.",
  readPermission: "refunds:read",
  permissions: {
    "refunds:read": { description: "View transactions, refunds and stats (card numbers masked)", roles: ["support_agent", "ops_manager", "compliance"] },
    "refunds:issue": { description: "Issue refunds against a transaction", roles: ["support_agent", "ops_manager"] },
    "refunds:approve_large": { description: "Second approver for refunds over $500", roles: ["ops_manager"] },
  },
  schema: `
    CREATE TABLE IF NOT EXISTS refunds_transactions (
      id INTEGER PRIMARY KEY,
      customer_name TEXT NOT NULL,
      card_brand TEXT NOT NULL,
      card_last4 TEXT NOT NULL CHECK (length(card_last4) = 4),
      merchant_descriptor TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured')),
      captured_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refunds_refunds (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES refunds_transactions(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason_code TEXT NOT NULL CHECK (reason_code IN ('duplicate','fraud','product_not_received','goodwill','other')),
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued')),
      issued_by TEXT NOT NULL REFERENCES users(id),
      approved_by TEXT REFERENCES users(id),
      issued_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS refunds_refunds_txn ON refunds_refunds(transaction_id);`,
  seed(conn) {
    // Synthetic data only. Only the last 4 digits of a card are ever stored; the full PAN never enters this app.
    // [customer, brand, last4, merchant descriptor, amount cents, hours ago]
    const txns: [string, string, string, string, number, number][] = [
      ["Maya Thompson", "Visa", "4242", "SQ *BLUE FERN COFFEE", 1_250, 6],
      ["Liam O'Connor", "Mastercard", "4444", "NORTHWIND OUTFITTERS", 18_999, 20],
      ["Chen Wei", "Visa", "1881", "CONTOSO AIR 0042", 480_000, 30],
      ["Fatima Al-Sayed", "Amex", "0005", "FABRIKAM HOTELS NYC", 129_500, 44],
      ["Diego Fernández", "Visa", "1111", "TAILSPIN TOYS ONLINE", 6_420, 52],
      ["Grace Kim", "Mastercard", "5100", "LITWARE STREAMING", 1_599, 70],
      ["Oluwaseun Adeyemi", "Visa", "0077", "WOODGROVE ELECTRONICS", 234_900, 90],
      ["Sofia Rossi", "Discover", "1117", "ALPINE SKI RENTALS", 32_000, 110],
      ["Noah Becker", "Visa", "3220", "ADVENTURE WORKS CYCLES", 89_900, 130],
      ["Aisha Khan", "Mastercard", "8210", "COHO WINERY CLUB", 7_480, 150],
      ["Lucas Martin", "Visa", "9424", "PROSEWARE BOOKS", 2_399, 175],
      ["Emily Davis", "Amex", "8431", "MARGIE'S TRAVEL", 312_000, 200],
      ["Hiro Tanaka", "Visa", "6600", "WINGTIP TOYS", 4_550, 260],
      ["Zara Ahmed", "Mastercard", "2718", "TREY RESEARCH LABS", 55_000, 320],
      ["Mateo Silva", "Visa", "3141", "GRAPHIC DESIGN INST", 15_000, 400],
    ];
    const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    const insertTxn = conn.prepare(
      `INSERT INTO refunds_transactions (id, customer_name, card_brand, card_last4, merchant_descriptor, amount_cents, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    txns.forEach(([name, brand, last4, merchant, cents, hours], i) => insertTxn.run(i + 1, name, brand, last4, merchant, cents, ago(hours)));

    // [txn id, amount cents, reason code, note, issued by, approved by, hours ago]
    const refunds: [number, number, string, string, string, string | null, number][] = [
      [2, 4_000, "goodwill", "Late delivery, partial credit", "sam", null, 10],
      [5, 6_420, "duplicate", "Customer charged twice", "sam", null, 30],
      [7, 60_000, "product_not_received", "One of two items never shipped", "sam", "omar", 60],
      [10, 7_480, "fraud", "Cardholder disputes, confirmed fraud", "priya", null, 100],
      [12, 150_000, "other", "Flight cancelled by airline, partial", "sam", "priya", 190],
      [14, 20_000, "goodwill", "Service outage credit", "omar", null, 300],
    ];
    const insertRefund = conn.prepare(
      `INSERT INTO refunds_refunds (transaction_id, amount_cents, reason_code, note, issued_by, approved_by, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [txn, cents, code, note, by, approvedBy, hours] of refunds) insertRefund.run(txn, cents, code, note, by, approvedBy, ago(hours));
  },
});
