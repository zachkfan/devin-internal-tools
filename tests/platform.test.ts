// Behavioural tests for the platform primitives, exercised through the KYC reference app.
import { beforeEach, describe, expect, it } from "vitest";
import { claimCase, decideCase, revealPii } from "@/app/apps/kyc/_app/actions";
import { getCase } from "@/app/apps/kyc/_app/queries";
import { decide, pendingFor } from "@/platform/approvals";
import { listAudit, verifyAuditChain } from "@/platform/audit";
import { getUser } from "@/platform/auth";
import { db, resetDbForTests } from "@/platform/db";

const u = (id: string) => getUser(id)!;
const firstCase = (where: string) => (db().prepare(`SELECT id FROM kyc_cases WHERE ${where} ORDER BY id LIMIT 1`).get() as { id: number }).id;
const status = (id: number) => getCase(id)!.status;
const lastAudit = () => listAudit({ limit: 1 })[0];

beforeEach(() => resetDbForTests());

describe("RBAC + audit", () => {
  it("denies users without the permission, and audits the attempt", () => {
    const id = firstCase("risk_score < 40 AND status = 'pending'");
    const res = decideCase.invoke(u("sam"), { caseId: id, decision: "approve" }, "trying");
    expect(res?.ok).toBe(false);
    expect(status(id)).toBe("pending");
    expect(lastAudit()).toMatchObject({ actorId: "sam", app: "kyc", action: "decide_case", outcome: "denied" });
  });

  it("requires a reason for sensitive actions", () => {
    const id = firstCase("risk_score < 40 AND status = 'pending'");
    expect(decideCase.invoke(u("ana"), { caseId: id, decision: "reject" }, "  ")?.message).toMatch(/reason/i);
    expect(status(id)).toBe("pending");
  });

  it("runs the mutation and its audit entry together", () => {
    const id = firstCase("risk_score < 40 AND status = 'pending'");
    expect(claimCase.invoke(u("ana"), { caseId: id })?.ok).toBe(true);
    expect(decideCase.invoke(u("ana"), { caseId: id, decision: "approve" }, "docs verified")?.ok).toBe(true);
    expect(status(id)).toBe("approved");
    expect(lastAudit()).toMatchObject({ actorId: "ana", outcome: "success", target: `kyc_case:${id}`, reason: "docs verified" });
  });

  it("rejects bad input before doing anything", () => {
    expect(decideCase.invoke(u("ana"), { caseId: "abc", decision: "approve" }, "x")?.ok).toBe(false);
    expect(decideCase.invoke(u("ana"), { caseId: 1, decision: "delete" }, "x")?.ok).toBe(false);
  });

  it("business errors roll back and are audited", () => {
    const id = firstCase("status = 'approved'");
    const res = decideCase.invoke(u("ana"), { caseId: id, decision: "reject" }, "oops");
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/already approved/) });
    expect(status(id)).toBe("approved");
    expect(lastAudit()).toMatchObject({ outcome: "error" });
  });
});

describe("maker-checker approvals", () => {
  it("high-risk approval waits for a second person with the approver permission", () => {
    const id = firstCase("risk_score >= 70 AND status = 'pending'");
    const res = decideCase.invoke(u("ana"), { caseId: id, decision: "approve" }, "looks fine");
    expect(res?.message).toMatch(/second approver/);
    expect(status(id)).toBe("pending");

    const [req] = pendingFor(u("omar"));
    expect(req).toMatchObject({ requested_by: "ana", target: `kyc_case:${id}` });
    expect(pendingFor(u("ana"))).toHaveLength(0);
    expect(decide(u("erin"), req.id, "approve", "lgtm")?.ok).toBe(false);

    expect(decide(u("omar"), req.id, "approve", "checked PEP list")?.ok).toBe(true);
    expect(status(id)).toBe("approved");
    const trail = listAudit({ target: `kyc_case:${id}` }).map((e) => `${e.actorId}:${e.outcome}`);
    expect(trail).toEqual(["ana:success", "omar:approved", "erin:denied", "ana:requested"]);
  });

  it("four-eyes: nobody can approve their own request", () => {
    const id = firstCase("risk_score >= 70 AND status = 'pending'");
    decideCase.invoke(u("omar"), { caseId: id, decision: "approve" }, "urgent");
    const req = pendingFor(u("priya"))[0];
    expect(decide(u("omar"), req.id, "approve", "self")?.message).toMatch(/four-eyes/);
    expect(status(id)).toBe("pending");
    expect(decide(u("priya"), req.id, "reject", "need EDD first")?.ok).toBe(true);
    expect(status(id)).toBe("pending");
    expect(decide(u("priya"), req.id, "approve", "changed mind")?.ok).toBe(false);
  });
});

describe("PII", () => {
  it("is masked by default and every reveal is audited", () => {
    const id = firstCase("1=1");
    const raw = (db().prepare("SELECT ssn FROM kyc_cases WHERE id = ?").get(id) as { ssn: string }).ssn;
    expect(getCase(id)!.ssnMasked).not.toContain(raw.slice(0, 3));
    expect(revealPii.invoke(u("ana"), { caseId: id, field: "ssn" }, "")?.ok).toBe(false);
    const res = revealPii.invoke(u("ana"), { caseId: id, field: "ssn" }, "verifying ID document");
    expect(res?.data).toEqual({ value: raw });
    expect(lastAudit()).toMatchObject({ actorId: "ana", action: "reveal_pii", outcome: "success", reason: "verifying ID document" });
    expect(lastAudit().details).not.toContain(raw);
  });
});

describe("audit log integrity", () => {
  it("is append-only", () => {
    claimCase.invoke(u("ana"), { caseId: firstCase("status = 'pending'") });
    expect(() => db().exec("UPDATE audit_log SET reason = 'edited'")).toThrow(/append-only/);
    expect(() => db().exec("DELETE FROM audit_log")).toThrow(/append-only/);
    expect(verifyAuditChain().ok).toBe(true);
  });

  it("detects tampering even if the trigger is bypassed", () => {
    claimCase.invoke(u("ana"), { caseId: firstCase("status = 'pending'") });
    decideCase.invoke(u("ana"), { caseId: firstCase("status = 'in_review'"), decision: "escalate" }, "needs EDD");
    db().exec("DROP TRIGGER audit_log_no_update; UPDATE audit_log SET actor_id = 'mallory' WHERE seq = 1");
    expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAt: 1 });
  });
});
