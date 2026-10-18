// Behavioural tests for the Refunds Dashboard (specs/refunds.md).
import { beforeEach, describe, expect, it } from "vitest";
import { issueRefund } from "@/app/apps/refunds/_app/actions";
import { getTransaction, listPendingRefunds, listRefunds, listTransactions, refundStats } from "@/app/apps/refunds/_app/queries";
import { decide, getRequest, pendingFor } from "@/platform/approvals";
import { listAudit, verifyAuditChain } from "@/platform/audit";
import { getUser } from "@/platform/auth";
import { db, resetDbForTests } from "@/platform/db";
import { can } from "@/platform/rbac";

const u = (id: string) => getUser(id)!;
const lastAudit = () => listAudit({ limit: 1 })[0];
const refunded = (id: number) => getTransaction(id)!.refundedCents;
const refundCount = () => (db().prepare("SELECT COUNT(*) AS n FROM refunds_refunds").get() as { n: number }).n;
/** Seeded fixtures (see manifest seed). */
const TXN = { small: 1 /* $12.50 */, big: 3 /* $4,800.00 */, mid: 9 /* $899.00 */, fullyRefunded: 5, hotel: 4 /* $1,295.00 */ };

beforeEach(() => resetDbForTests());

describe("seed + permissions", () => {
  it("seeds ~15 synthetic transactions between $12 and $4,800", () => {
    const txns = listTransactions();
    expect(txns).toHaveLength(15);
    for (const t of txns) {
      expect(t.amountCents).toBeGreaterThanOrEqual(1_200);
      expect(t.amountCents).toBeLessThanOrEqual(480_000);
      expect(t.refundedCents).toBeLessThanOrEqual(t.amountCents);
    }
  });

  it("grants permissions per spec", () => {
    expect(["sam", "omar", "cora"].every((id) => can(u(id), "refunds:read"))).toBe(true);
    expect(["ana", "erin", "lee"].some((id) => can(u(id), "refunds:read"))).toBe(false);
    expect(["sam", "omar"].every((id) => can(u(id), "refunds:issue"))).toBe(true);
    expect(can(u("cora"), "refunds:issue")).toBe(false);
    expect(can(u("omar"), "refunds:approve_large")).toBe(true);
    expect(["sam", "cora"].some((id) => can(u(id), "refunds:approve_large"))).toBe(false);
  });

  it("denies users without refunds:issue, and audits the attempt", () => {
    for (const id of ["cora", "ana"]) {
      const res = issueRefund.invoke(u(id), { transactionId: TXN.small, amount: 5, reasonCode: "goodwill" }, "trying");
      expect(res?.ok).toBe(false);
      expect(lastAudit()).toMatchObject({ actorId: id, app: "refunds", action: "issue_refund", outcome: "denied" });
    }
    expect(refunded(TXN.small)).toBe(0);
  });
});

describe("issuing refunds", () => {
  it("happy path: records an issued refund and an audit entry with the reason", () => {
    const before = refundCount();
    const res = issueRefund.invoke(u("sam"), { transactionId: TXN.small, amount: "5.25", reasonCode: "product_not_received" }, "item missing from box");
    expect(res).toMatchObject({ ok: true, message: expect.stringMatching(/issued/) });
    expect(refundCount()).toBe(before + 1);
    expect(getTransaction(TXN.small)).toMatchObject({ refundedCents: 525, remainingCents: 725, refundState: "partial" });
    expect(listRefunds(TXN.small)[0]).toMatchObject({ amountCents: 525, reasonCode: "product_not_received", status: "issued", issuedBy: "sam", approvedBy: null, note: "item missing from box" });
    expect(lastAudit()).toMatchObject({ actorId: "sam", outcome: "success", target: `refunds_txn:${TXN.small}`, reason: "item missing from box" });
    expect(JSON.parse(lastAudit().details)).toMatchObject({ before: { refundedCents: 0 }, after: { refundedCents: 525 } });
  });

  it("allows a full refund up to the exact captured amount", () => {
    expect(issueRefund.invoke(u("sam"), { transactionId: TXN.small, amount: 12.5, reasonCode: "duplicate" }, "double charge")?.ok).toBe(true);
    expect(getTransaction(TXN.small)).toMatchObject({ remainingCents: 0, refundState: "full" });
  });

  it("requires the free-text reason", () => {
    expect(issueRefund.invoke(u("sam"), { transactionId: TXN.small, amount: 5, reasonCode: "goodwill" }, "  ")?.message).toMatch(/reason/i);
    expect(refunded(TXN.small)).toBe(0);
  });

  it("rejects bad input before doing anything", () => {
    for (const input of [
      { transactionId: TXN.small, amount: 0, reasonCode: "goodwill" },
      { transactionId: TXN.small, amount: -5, reasonCode: "goodwill" },
      { transactionId: TXN.small, amount: 1.234, reasonCode: "goodwill" },
      { transactionId: TXN.small, amount: 0.000000001, reasonCode: "goodwill" },
      { transactionId: TXN.small, amount: "abc", reasonCode: "goodwill" },
      { transactionId: TXN.small, amount: 5, reasonCode: "because" },
    ]) expect(issueRefund.invoke(u("sam"), input, "x")?.ok).toBe(false);
    expect(refunded(TXN.small)).toBe(0);
  });

  it("can't refund more than the remaining amount; error is audited and nothing is written", () => {
    const before = refundCount();
    const res = issueRefund.invoke(u("sam"), { transactionId: TXN.small, amount: 12.51, reasonCode: "goodwill" }, "too much");
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/exceeds the remaining refundable/) });
    expect(issueRefund.invoke(u("sam"), { transactionId: TXN.fullyRefunded, amount: 0.01, reasonCode: "goodwill" }, "again")?.ok).toBe(false);
    expect(refundCount()).toBe(before);
    expect(lastAudit()).toMatchObject({ outcome: "error" });
  });

  it("over-limit large refunds fail fast instead of landing in the approvals inbox", () => {
    const res = issueRefund.invoke(u("sam"), { transactionId: TXN.hotel, amount: 1_295.01, reasonCode: "fraud" }, "full plus");
    expect(res?.ok).toBe(false);
    expect(pendingFor(u("omar"))).toHaveLength(0);
  });

  it("unknown transaction is a business error", () => {
    expect(issueRefund.invoke(u("sam"), { transactionId: 999, amount: 1, reasonCode: "other" }, "x")?.message).toMatch(/not found/);
  });
});

describe("large refund approvals (> $500 needs refunds:approve_large)", () => {
  it("exactly $500.00 executes immediately", () => {
    const res = issueRefund.invoke(u("sam"), { transactionId: TXN.big, amount: 500, reasonCode: "goodwill" }, "at threshold");
    expect(res?.message).toMatch(/issued/);
    expect(refunded(TXN.big)).toBe(50_000);
    expect(pendingFor(u("omar"))).toHaveLength(0);
  });

  it("$500.01 waits for an ops manager; requester and non-approvers can't approve", () => {
    const res = issueRefund.invoke(u("sam"), { transactionId: TXN.big, amount: 500.01, reasonCode: "product_not_received" }, "never arrived");
    expect(res?.message).toMatch(/second approver/);
    expect(refunded(TXN.big)).toBe(0);
    expect(refundStats().pendingApprovals).toBe(1);
    expect(listPendingRefunds()[0]).toMatchObject({ transactionId: TXN.big, amountCents: 50_001, requestedBy: "sam" });

    const [req] = pendingFor(u("omar"));
    expect(req).toMatchObject({ app: "refunds", action: "issue_refund", requested_by: "sam", target: `refunds_txn:${TXN.big}` });
    expect(pendingFor(u("sam"))).toHaveLength(0);
    expect(decide(u("sam"), req.id, "approve", "self")?.ok).toBe(false);
    expect(decide(u("cora"), req.id, "approve", "lgtm")?.ok).toBe(false);
    expect(refunded(TXN.big)).toBe(0);

    expect(decide(u("omar"), req.id, "approve", "confirmed with carrier")?.ok).toBe(true);
    expect(refunded(TXN.big)).toBe(50_001);
    expect(listRefunds(TXN.big)[0]).toMatchObject({ issuedBy: "sam", approvedBy: "omar", note: "never arrived" });
    expect(refundStats().pendingApprovals).toBe(0);
    const trail = listAudit({ target: `refunds_txn:${TXN.big}` }).map((e) => `${e.actorId}:${e.outcome}`);
    expect(trail).toEqual(["sam:success", "omar:approved", "cora:denied", "sam:denied", "sam:requested"]);
    expect(verifyAuditChain().ok).toBe(true);
  });

  it("four-eyes: an ops manager can't approve their own large refund", () => {
    issueRefund.invoke(u("omar"), { transactionId: TXN.big, amount: 1_000, reasonCode: "fraud" }, "confirmed fraud");
    const [req] = pendingFor(u("priya"));
    expect(decide(u("omar"), req.id, "approve", "self")?.message).toMatch(/four-eyes/);
    expect(refunded(TXN.big)).toBe(0);
    expect(decide(u("priya"), req.id, "reject", "send to disputes instead")?.ok).toBe(true);
    expect(refunded(TXN.big)).toBe(0);
    expect(getRequest(req.id)?.status).toBe("rejected");
  });

  it("an approved request re-checks the cap against current data and rolls back if it would over-refund", () => {
    // Two $600 requests on an $899 transaction: each fits on its own, both together don't.
    issueRefund.invoke(u("sam"), { transactionId: TXN.mid, amount: 600, reasonCode: "duplicate" }, "first");
    issueRefund.invoke(u("sam"), { transactionId: TXN.mid, amount: 600, reasonCode: "duplicate" }, "second");
    const [first, second] = pendingFor(u("omar"));
    expect(decide(u("omar"), first.id, "approve", "ok")?.ok).toBe(true);
    const res = decide(u("omar"), second.id, "approve", "ok");
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/exceeds the remaining refundable/) });
    expect(getRequest(second.id)?.status).toBe("failed");
    expect(refunded(TXN.mid)).toBe(60_000);
  });

  it("a small refund issued while a large one waits is counted when the large one executes", () => {
    issueRefund.invoke(u("sam"), { transactionId: TXN.mid, amount: 800, reasonCode: "goodwill" }, "large");
    expect(issueRefund.invoke(u("sam"), { transactionId: TXN.mid, amount: 200, reasonCode: "goodwill" }, "small")?.ok).toBe(true);
    const [req] = pendingFor(u("priya"));
    expect(decide(u("priya"), req.id, "approve", "ok")?.ok).toBe(false);
    expect(refunded(TXN.mid)).toBe(20_000);
  });
});

describe("queries", () => {
  it("only exposes the masked last 4 of the card", () => {
    const t = getTransaction(TXN.small)!;
    expect(t.cardMasked).toMatch(/^•••• 4242$/);
    expect(Object.keys(t)).not.toContain("cardLast4");
    expect(listRefunds()[0].cardMasked).toMatch(/^•••• \d{4}$/);
  });

  it("searches by customer, merchant, card last 4 and transaction id", () => {
    expect(listTransactions("thompson").map((t) => t.id)).toEqual([1]);
    expect(listTransactions("coffee").map((t) => t.id)).toEqual([1]);
    expect(listTransactions("4242").map((t) => t.id)).toEqual([1]);
    expect(listTransactions("3").map((t) => t.id)).toEqual([3]);
    expect(listTransactions("no such thing")).toEqual([]);
    expect(listTransactions("%")).toEqual([]);
    expect(listTransactions("_")).toEqual([]);
  });

  it("computes headline stats", () => {
    const before = refundStats();
    expect(before.refundRate).toBeCloseTo(before.refundedCents / before.capturedCents);
    issueRefund.invoke(u("sam"), { transactionId: TXN.small, amount: 10, reasonCode: "goodwill" }, "x");
    const after = refundStats();
    expect(after.refunds7dCount).toBe(before.refunds7dCount + 1);
    expect(after.refunded7dCents).toBe(before.refunded7dCents + 1_000);
  });
});
