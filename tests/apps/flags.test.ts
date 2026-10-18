// Behavioural tests for the Feature Flag Admin app (specs/flags.md).
import { beforeEach, describe, expect, it } from "vitest";
import { createFlag, killSwitch, setFlagState } from "@/app/apps/flags/_app/actions";
import { getFlag, listFlags, type Env } from "@/app/apps/flags/_app/queries";
import { decide, pendingFor } from "@/platform/approvals";
import { listAudit } from "@/platform/audit";
import { getUser } from "@/platform/auth";
import { resetDbForTests } from "@/platform/db";

const u = (id: string) => getUser(id)!;
const byKey = (key: string) => listFlags().find((f) => f.key === key)!;
const state = (key: string, env: Env) => {
  const s = getFlag(byKey(key).id)!.states[env];
  return { enabled: s.enabled, rollout: s.rollout };
};
const lastAudit = () => listAudit({ limit: 1 })[0];
/** Builds set_flag_state input against the flag's current state, like the detail page form does. */
const change = (key: string, env: Env, enabled: "on" | "off", rollout: number) => {
  const f = byKey(key);
  return { flagId: f.id, env, enabled, rollout, fromEnabled: f.states[env].enabled ? "on" : "off", fromRollout: f.states[env].rollout };
};

beforeEach(() => resetDbForTests());

describe("seed + queries", () => {
  it("seeds ~10 flags in a mix of states, all respecting off => rollout 0", () => {
    const flags = listFlags();
    expect(flags.length).toBeGreaterThanOrEqual(8);
    expect(flags.some((f) => f.liveInProd)).toBe(true);
    expect(flags.some((f) => !f.liveInProd)).toBe(true);
    expect(flags.some((f) => f.liveInProd && f.states.prod.rollout < 100)).toBe(true);
    for (const f of flags) for (const s of Object.values(f.states)) if (!s.enabled) expect(s.rollout).toBe(0);
  });
});

describe("RBAC", () => {
  it("ops managers can read but not change, create or kill; denials are audited", () => {
    const id = byKey("card_controls_v2").id;
    expect(setFlagState.invoke(u("omar"), change("card_controls_v2", "dev", "off", 0), "trying")?.ok).toBe(false);
    expect(lastAudit()).toMatchObject({ actorId: "omar", app: "flags", action: "set_flag_state", outcome: "denied" });
    expect(createFlag.invoke(u("omar"), { key: "omar_flag", description: "x", owner: "ops" }, "trying")?.ok).toBe(false);
    expect(lastAudit()).toMatchObject({ actorId: "omar", action: "create_flag", outcome: "denied" });
    expect(killSwitch.invoke(u("omar"), { flagId: byKey("instant_payouts").id }, "incident")?.ok).toBe(false);
    expect(lastAudit()).toMatchObject({ actorId: "omar", action: "kill_switch", outcome: "denied" });
    expect(state("instant_payouts", "prod")).toEqual({ enabled: true, rollout: 100 });
    expect(getFlag(id)!.states.dev.enabled).toBe(true);
  });

  it("users without flags:read get nothing (support agent)", () => {
    expect(setFlagState.invoke(u("sam"), change("dark_mode", "dev", "off", 0), "x")?.ok).toBe(false);
    expect(lastAudit()).toMatchObject({ actorId: "sam", outcome: "denied" });
  });
});

describe("create flag", () => {
  it("creates a flag that starts off everywhere, audited with the reason", () => {
    const res = createFlag.invoke(u("erin"), { key: "new_checkout_flow", description: "One-page checkout", owner: "payments" }, "Q3 roadmap");
    expect(res?.ok).toBe(true);
    const f = byKey("new_checkout_flow");
    expect(f).toMatchObject({ owner: "payments", createdBy: "erin", liveInProd: false });
    for (const env of ["dev", "staging", "prod"] as const) expect(state("new_checkout_flow", env)).toEqual({ enabled: false, rollout: 0 });
    expect(lastAudit()).toMatchObject({ actorId: "erin", action: "create_flag", outcome: "success", target: `flags_flag:${f.id}`, reason: "Q3 roadmap" });
  });

  it("requires a snake_case, unique key and a reason", () => {
    for (const key of ["NewCheckout", "new-checkout", "new__checkout", "_new", "9lives", "ab"]) {
      expect(createFlag.invoke(u("erin"), { key, description: "d", owner: "payments" }, "r")?.ok, key).toBe(false);
    }
    expect(createFlag.invoke(u("erin"), { key: "instant_payouts", description: "d", owner: "payments" }, "r")?.message).toMatch(/already exists/);
    expect(createFlag.invoke(u("erin"), { key: "ok_key", description: "d", owner: "payments" }, " ")?.message).toMatch(/reason/i);
  });
});

describe("dev / staging changes apply immediately", () => {
  it("engineer changes staging rollout without approval", () => {
    const res = setFlagState.invoke(u("erin"), change("card_controls_v2", "staging", "on", 80), "widen beta");
    expect(res?.message).toMatch(/now on @ 80% in staging/);
    expect(state("card_controls_v2", "staging")).toEqual({ enabled: true, rollout: 80 });
    expect(pendingFor(u("lee"))).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ actorId: "erin", action: "set_flag_state", outcome: "success", reason: "widen beta" });
  });

  it("turning a flag off forces rollout to 0", () => {
    expect(setFlagState.invoke(u("erin"), change("card_controls_v2", "staging", "off", 50), "pause")?.ok).toBe(true);
    expect(state("card_controls_v2", "staging")).toEqual({ enabled: false, rollout: 0 });
  });

  it("rollout must be an integer 0-100", () => {
    for (const rollout of [101, -1, 12.5, "abc"]) {
      expect(setFlagState.invoke(u("erin"), { ...change("dark_mode", "dev", "on", 0), rollout }, "x")?.ok, String(rollout)).toBe(false);
    }
    expect(state("dark_mode", "dev")).toEqual({ enabled: true, rollout: 100 });
  });

  it("refuses no-op changes and changes made against a stale view", () => {
    expect(setFlagState.invoke(u("erin"), change("dark_mode", "dev", "on", 100), "x")?.message).toMatch(/already on @ 100%/);
    const stale = change("dark_mode", "dev", "on", 10);
    setFlagState.invoke(u("lee"), change("dark_mode", "dev", "on", 50), "lee first");
    expect(setFlagState.invoke(u("erin"), stale, "erin second")?.message).toMatch(/changed in dev since/);
    expect(state("dark_mode", "dev")).toEqual({ enabled: true, rollout: 50 });
  });
});

describe("prod changes need an eng lead (maker-checker)", () => {
  it("enable in prod waits for a second person with flags:approve_prod", () => {
    const id = byKey("card_controls_v2").id;
    const res = setFlagState.invoke(u("erin"), change("card_controls_v2", "prod", "on", 10), "start prod canary");
    expect(res?.message).toMatch(/second approver/);
    expect(state("card_controls_v2", "prod")).toEqual({ enabled: false, rollout: 0 });

    const [req] = pendingFor(u("lee"));
    expect(req).toMatchObject({ requested_by: "erin", target: `flags_flag:${id}` });
    expect(req.summary).toMatch(/card_controls_v2: off → on @ 10%/);
    expect(pendingFor(u("erin"))).toHaveLength(0);
    expect(pendingFor(u("omar"))).toHaveLength(0);
    expect(decide(u("omar"), req.id, "approve", "lgtm")?.ok).toBe(false);

    expect(decide(u("lee"), req.id, "approve", "canary plan reviewed")?.ok).toBe(true);
    expect(state("card_controls_v2", "prod")).toEqual({ enabled: true, rollout: 10 });
    const trail = listAudit({ target: `flags_flag:${id}` }).map((e) => `${e.actorId}:${e.outcome}`);
    expect(trail).toEqual(["erin:success", "lee:approved", "omar:denied", "erin:requested"]);
  });

  it("rollout changes and disabling in prod also need approval", () => {
    expect(setFlagState.invoke(u("erin"), change("new_onboarding_flow", "prod", "on", 50), "ramp")?.message).toMatch(/second approver/);
    expect(setFlagState.invoke(u("erin"), change("ach_same_day", "prod", "off", 0), "turn off")?.message).toMatch(/second approver/);
    expect(state("new_onboarding_flow", "prod")).toEqual({ enabled: true, rollout: 25 });
    expect(state("ach_same_day", "prod")).toEqual({ enabled: true, rollout: 10 });
    expect(pendingFor(u("lee"))).toHaveLength(2);
  });

  it("four-eyes: an eng lead can't approve their own prod change", () => {
    setFlagState.invoke(u("lee"), change("new_onboarding_flow", "prod", "on", 100), "full launch");
    const req = pendingFor(u("lee"));
    expect(req).toHaveLength(0);
    const all = listAudit({ target: `flags_flag:${byKey("new_onboarding_flow").id}` });
    const approvalId = JSON.parse(all[0].details).approvalId as number;
    expect(decide(u("lee"), approvalId, "approve", "self")?.message).toMatch(/four-eyes/);
    expect(state("new_onboarding_flow", "prod")).toEqual({ enabled: true, rollout: 25 });
  });

  it("an approved request fails if prod changed in the meantime (e.g. kill switch fired)", () => {
    setFlagState.invoke(u("erin"), change("new_onboarding_flow", "prod", "on", 50), "ramp to 50");
    const [req] = pendingFor(u("lee"));
    expect(killSwitch.invoke(u("erin"), { flagId: byKey("new_onboarding_flow").id }, "INC-1234 signup errors")?.ok).toBe(true);
    const res = decide(u("lee"), req.id, "approve", "ok");
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/changed in prod since/) });
    expect(state("new_onboarding_flow", "prod")).toEqual({ enabled: false, rollout: 0 });
  });
});

describe("kill switch", () => {
  it("turns a flag off in prod immediately, with no approval, and is audited", () => {
    const id = byKey("instant_payouts").id;
    const res = killSwitch.invoke(u("erin"), { flagId: id }, "INC-42 payout failures");
    expect(res?.message).toMatch(/Killed instant_payouts/);
    expect(state("instant_payouts", "prod")).toEqual({ enabled: false, rollout: 0 });
    expect(state("instant_payouts", "staging")).toEqual({ enabled: true, rollout: 100 });
    expect(pendingFor(u("lee"))).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ actorId: "erin", action: "kill_switch", outcome: "success", target: `flags_flag:${id}`, reason: "INC-42 payout failures" });
    expect(JSON.parse(lastAudit().details)).toMatchObject({ breakGlass: true, before: { enabled: true, rollout: 100 }, after: { enabled: false, rollout: 0 } });
  });

  it("still requires a reason, and refuses flags already off in prod", () => {
    const id = byKey("instant_payouts").id;
    expect(killSwitch.invoke(u("erin"), { flagId: id }, "")?.message).toMatch(/reason/i);
    expect(state("instant_payouts", "prod").enabled).toBe(true);
    expect(killSwitch.invoke(u("erin"), { flagId: byKey("card_controls_v2").id }, "x")?.message).toMatch(/already off in prod/);
  });
});
