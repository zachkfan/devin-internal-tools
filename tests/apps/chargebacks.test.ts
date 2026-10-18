import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptDispute, addEvidence, contestDispute } from "@/app/apps/chargebacks/_app/actions";
import { daysLeft, getDispute, listDisputes, listEvidence } from "@/app/apps/chargebacks/_app/queries";
import { decide, pendingFor } from "@/platform/approvals";
import { listAudit } from "@/platform/audit";
import { getUser } from "@/platform/auth";
import { db, resetDbForTests } from "@/platform/db";

const u = (id: string) => getUser(id)!;
const ids = (where: string) =>
  (db().prepare(`SELECT d.id FROM chargebacks_disputes d WHERE ${where} ORDER BY d.id`).all() as { id: number }[]).map((r) => r.id);
const first = (where: string) => ids(where)[0];
const hasEvidence = "EXISTS (SELECT 1 FROM chargebacks_evidence e WHERE e.dispute_id = d.id)";
const noEvidence = `NOT ${hasEvidence}`;
const status = (id: number) => getDispute(id)!.status;
const lastAudit = () => listAudit({ limit: 1 })[0];
const withEvidence = (id: number, who = "sam") => {
  expect(addEvidence.invoke(u(who), { disputeId: id, note: "AVS + CVV matched; signed proof of delivery." })?.ok).toBe(true);
  return id;
};

beforeEach(() => resetDbForTests());
afterEach(() => vi.useRealTimers());

describe("seed + queue", () => {
  it("seeds ~10 synthetic disputes with varied reason codes, statuses and deadlines", () => {
    const rows = db().prepare("SELECT reason_category, status, card_last4 FROM chargebacks_disputes").all() as { reason_category: string; status: string; card_last4: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(new Set(rows.map((r) => r.reason_category)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["open", "accepted", "contested"]));
    for (const r of rows) expect(r.card_last4).toMatch(/^\d{4}$/);
  });

  it("open queue is sorted by deadline and flags < 3 days left as urgent", () => {
    const open = listDisputes("open");
    expect(open.map((d) => d.respondBy)).toEqual([...open.map((d) => d.respondBy)].sort());
    for (const d of open) expect(d.urgent).toBe(d.daysLeft < 3);
    expect(open.some((d) => d.urgent)).toBe(true);
    expect(open.some((d) => !d.urgent)).toBe(true);
  });

  it("computes whole days left in UTC", () => {
    const now = new Date("2026-03-10T23:30:00Z");
    expect(daysLeft("2026-03-10", now)).toBe(0);
    expect(daysLeft("2026-03-13", now)).toBe(3);
    expect(daysLeft("2026-03-09", now)).toBe(-1);
  });

  it("masks card numbers in view models", () => {
    const d = getDispute(first("1=1"))!;
    expect(d.cardMasked).toMatch(/^\u2022{4} \d{4}$/);
  });
});

describe("RBAC", () => {
  it("denies users without the permission, and audits the attempt", () => {
    const id = first(`d.status = 'open' AND ${hasEvidence} AND d.amount_cents <= 100000`);
    for (const who of ["cora", "erin", "ana"]) {
      expect(acceptDispute.invoke(u(who), { disputeId: id }, "trying")?.ok).toBe(false);
      expect(lastAudit()).toMatchObject({ actorId: who, app: "chargebacks", action: "accept_dispute", outcome: "denied" });
    }
    expect(contestDispute.invoke(u("cora"), { disputeId: id }, "trying")?.ok).toBe(false);
    expect(addEvidence.invoke(u("cora"), { disputeId: id, note: "compliance should be read-only" })?.ok).toBe(false);
    expect(lastAudit()).toMatchObject({ actorId: "cora", action: "add_evidence", outcome: "denied" });
    expect(status(id)).toBe("open");
  });

  it("requires a reason to accept or contest", () => {
    const id = first(`d.status = 'open' AND ${hasEvidence} AND d.amount_cents <= 100000`);
    expect(acceptDispute.invoke(u("sam"), { disputeId: id }, " ")?.message).toMatch(/reason/i);
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "")?.message).toMatch(/reason/i);
    expect(status(id)).toBe("open");
  });
});

describe("evidence -> accept / contest", () => {
  it("adds an evidence note and audits it without storing the note text", () => {
    const id = first(`d.status = 'open' AND ${noEvidence}`);
    const note = "Customer emailed confirming receipt on order ORD-1234.";
    expect(addEvidence.invoke(u("sam"), { disputeId: id, note })?.ok).toBe(true);
    expect(listEvidence(id)).toMatchObject([{ authorId: "sam", note }]);
    expect(lastAudit()).toMatchObject({ actorId: "sam", action: "add_evidence", outcome: "success", target: `chargeback:${id}` });
    expect(lastAudit().details).not.toContain("ORD-1234");
  });

  it("rejects too-short evidence notes", () => {
    const id = first(`d.status = 'open' AND ${noEvidence}`);
    expect(addEvidence.invoke(u("sam"), { disputeId: id, note: "ok" })?.ok).toBe(false);
    expect(listEvidence(id)).toHaveLength(0);
  });

  it("can't accept or contest without a written evidence note", () => {
    const id = first(`d.status = 'open' AND ${noEvidence} AND d.amount_cents <= 100000 AND d.respond_by >= date('now')`);
    expect(acceptDispute.invoke(u("sam"), { disputeId: id }, "refund")?.message).toMatch(/evidence/i);
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "contest")?.message).toMatch(/evidence/i);
    expect(status(id)).toBe("open");
    expect(lastAudit()).toMatchObject({ outcome: "error" });
  });

  it("accepting refunds the customer the full amount and audits the reason", () => {
    const id = withEvidence(first(`d.status = 'open' AND ${noEvidence} AND d.amount_cents > 100000`));
    const res = acceptDispute.invoke(u("sam"), { disputeId: id }, "no proof of delivery");
    expect(res).toMatchObject({ ok: true, message: expect.stringMatching(/refunded/) });
    const d = getDispute(id)!;
    expect(d).toMatchObject({ status: "accepted", refundedCents: d.amountCents, decidedBy: "sam", decisionNote: "no proof of delivery" });
    expect(lastAudit()).toMatchObject({ actorId: "sam", action: "accept_dispute", outcome: "success", target: `chargeback:${id}`, reason: "no proof of delivery" });
  });

  it("closed disputes can't be decided again or get more evidence", () => {
    const accepted = first("d.status = 'accepted'");
    const contested = first("d.status = 'contested'");
    expect(contestDispute.invoke(u("omar"), { disputeId: accepted }, "changed mind")?.message).toMatch(/already accepted/);
    expect(acceptDispute.invoke(u("omar"), { disputeId: contested }, "changed mind")?.message).toMatch(/already contested/);
    const auditCount = listAudit({ limit: 1000 }).length;
    expect(addEvidence.invoke(u("sam"), { disputeId: accepted, note: "late evidence for cardholder ORD-9876" })).toMatchObject({ ok: false, message: expect.stringMatching(/only be added to open disputes/) });
    expect(listAudit({ limit: 1000 }).map((e) => JSON.stringify(e)).join("\n")).not.toContain("ORD-9876");
    expect(listAudit({ limit: 1000 })).toHaveLength(auditCount);
    expect(status(accepted)).toBe("accepted");
    expect(status(contested)).toBe("contested");
  });

  it("can't contest after the respond-by date has passed", () => {
    const id = withEvidence(first("d.status = 'open' AND d.respond_by < date('now')"));
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "late")?.message).toMatch(/respond-by/);
    expect(status(id)).toBe("open");
    expect(acceptDispute.invoke(u("sam"), { disputeId: id }, "missed the window")?.ok).toBe(true);
  });
});

describe("contest approvals (over $1,000 needs an Ops Manager)", () => {
  it("contesting at or under $1,000 executes immediately", () => {
    const id = first(`d.status = 'open' AND d.amount_cents = 100000`);
    withEvidence(id);
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "credit was issued already")?.message).toMatch(/contested/);
    expect(status(id)).toBe("contested");
    expect(pendingFor(u("omar"))).toHaveLength(0);
  });

  it("contesting over $1,000 waits for an Ops Manager; requester and non-approvers can't approve", () => {
    const id = withEvidence(first(`d.status = 'open' AND d.amount_cents = 100001`));
    const res = contestDispute.invoke(u("sam"), { disputeId: id }, "3DS authenticated");
    expect(res?.message).toMatch(/second approver/);
    expect(status(id)).toBe("open");

    const [req] = pendingFor(u("omar"));
    expect(req).toMatchObject({ requested_by: "sam", target: `chargeback:${id}`, summary: expect.stringMatching(/\$1,000\.01/) });
    expect(pendingFor(u("sam"))).toHaveLength(0);
    expect(pendingFor(u("cora"))).toHaveLength(0);
    expect(decide(u("sam"), req.id, "approve", "self")?.ok).toBe(false);
    expect(decide(u("cora"), req.id, "approve", "lgtm")?.ok).toBe(false);
    expect(status(id)).toBe("open");

    expect(decide(u("omar"), req.id, "approve", "evidence is strong")?.ok).toBe(true);
    expect(getDispute(id)).toMatchObject({ status: "contested", decidedBy: "sam", decisionNote: "3DS authenticated" });
    const trail = listAudit({ target: `chargeback:${id}` }).map((e) => `${e.actorId}:${e.action}:${e.outcome}`);
    expect(trail).toEqual([
      "sam:contest_dispute:success", "omar:contest_dispute:approved", "cora:contest_dispute:denied", "sam:contest_dispute:denied",
      "sam:contest_dispute:requested", "sam:add_evidence:success",
    ]);
  });

  it("four-eyes: an Ops Manager's own over-threshold contest needs a different Ops Manager", () => {
    const id = first(`d.status = 'open' AND ${hasEvidence} AND d.amount_cents > 100000 AND d.respond_by >= date('now')`);
    expect(contestDispute.invoke(u("omar"), { disputeId: id }, "fraud claim is weak")?.message).toMatch(/second approver/);
    const [req] = pendingFor(u("priya"));
    expect(decide(u("omar"), req.id, "approve", "self")?.message).toMatch(/four-eyes/);
    expect(decide(u("priya"), req.id, "reject", "accept instead")?.ok).toBe(true);
    expect(status(id)).toBe("open");
  });

  it("won't queue a second contest while one is waiting for approval", () => {
    const id = withEvidence(first(`d.status = 'open' AND d.amount_cents > 100000 AND d.respond_by >= date('now')`));
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "contest it")?.message).toMatch(/second approver/);
    expect(contestDispute.invoke(u("priya"), { disputeId: id }, "contest it again")).toMatchObject({ ok: false, message: expect.stringMatching(/already waiting for approval/) });
    expect(pendingFor(u("omar"))).toHaveLength(1);
    const [req] = pendingFor(u("omar"));
    expect(decide(u("omar"), req.id, "approve", "ok")?.ok).toBe(true);
    expect(status(id)).toBe("contested");
  });

  it("an approved contest fails if the dispute was accepted in the meantime", () => {
    const id = first(`d.status = 'open' AND ${hasEvidence} AND d.amount_cents > 100000`);
    contestDispute.invoke(u("sam"), { disputeId: id }, "contest it");
    const [req] = pendingFor(u("omar"));
    expect(acceptDispute.invoke(u("priya"), { disputeId: id }, "not worth contesting")?.ok).toBe(true);
    expect(decide(u("omar"), req.id, "approve", "ok")).toMatchObject({ ok: false, message: expect.stringMatching(/already accepted/) });
    expect(getDispute(id)).toMatchObject({ status: "accepted", decidedBy: "priya" });
  });

  it("an approved contest fails if the respond-by date passed while it waited", () => {
    const id = withEvidence(first(`d.status = 'open' AND d.amount_cents > 100000 AND d.respond_by >= date('now')`));
    contestDispute.invoke(u("sam"), { disputeId: id }, "contest it");
    const [req] = pendingFor(u("omar"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(`${getDispute(id)!.respondBy}T00:00:00Z`) + 2 * 86_400_000));
    expect(decide(u("omar"), req.id, "approve", "ok")).toMatchObject({ ok: false, message: expect.stringMatching(/respond-by/) });
    expect(status(id)).toBe("open");
  });

  it("over-threshold contests without evidence fail fast instead of reaching the inbox", () => {
    const id = first(`d.status = 'open' AND ${noEvidence} AND d.amount_cents > 100000 AND d.respond_by >= date('now')`);
    expect(contestDispute.invoke(u("sam"), { disputeId: id }, "contest it")).toMatchObject({ ok: false, message: expect.stringMatching(/evidence/) });
    expect(pendingFor(u("omar"))).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ actorId: "sam", action: "contest_dispute", outcome: "error" });
    expect(status(id)).toBe("open");
  });
});
