"use server";

import { z } from "zod";
import { ActionError, defineAction } from "@/platform/action";
import { db } from "@/platform/db";
import { ENVS, type Env } from "./manifest";
import { getFlagByKey, getFlagRow, getStateRow } from "./queries";

const flagId = z.coerce.number().int().positive();
const rollout = z.coerce.number().int("Rollout must be a whole number").min(0).max(100);
const onOff = z.enum(["on", "off"]);
const fmt = (enabled: boolean, pct: number) => (enabled ? `on @ ${pct}%` : "off");

function loadFlag(id: number) {
  const row = getFlagRow(id);
  if (!row) throw new ActionError(`Flag #${id} not found.`);
  return row;
}

export const createFlag = defineAction({
  app: "flags",
  name: "create_flag",
  permission: "flags:edit",
  input: z.object({
    key: z.string().trim().min(3).max(64).regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, "Key must be snake_case (e.g. new_checkout_flow)"),
    description: z.string().trim().min(1).max(500),
    owner: z.string().trim().min(2).max(60),
  }),
  run: ({ key, description, owner }, ctx) => {
    if (getFlagByKey(key)) throw new ActionError(`A flag named ${key} already exists.`);
    const now = new Date().toISOString();
    const id = Number(
      db().prepare("INSERT INTO flags_flags (key, description, owner, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(key, description, owner, ctx.user.id, now).lastInsertRowid,
    );
    const state = db().prepare("INSERT INTO flags_states (flag_id, env, enabled, rollout, updated_by, updated_at) VALUES (?, ?, 0, 0, ?, ?)");
    for (const env of ENVS) state.run(id, env, ctx.user.id, now);
    ctx.setTarget(`flags_flag:${id}`);
    ctx.record({ after: { key, owner, dev: "off", staging: "off", prod: "off" } });
    return `Created ${key} (off in every environment).`;
  },
});

type StateChange = { flagId: number; env: Env; enabled: "on" | "off"; rollout: number; fromVersion: number };

function checkChange(i: StateChange) {
  const f = loadFlag(i.flagId);
  const cur = getStateRow(i.flagId, i.env);
  if (!cur) throw new ActionError(`Flag ${f.key} has no ${i.env} state.`);
  const enabled = i.enabled === "on";
  const pct = enabled ? i.rollout : 0;
  if (cur.version !== i.fromVersion) {
    throw new ActionError(`${f.key} changed in ${i.env} since this was submitted (now ${fmt(cur.enabled === 1, cur.rollout)}). Re-submit against the current state.`);
  }
  if (cur.enabled === (enabled ? 1 : 0) && cur.rollout === pct) throw new ActionError(`${f.key} is already ${fmt(enabled, pct)} in ${i.env}.`);
  return { f, cur, enabled, pct };
}

export const setFlagState = defineAction({
  app: "flags",
  name: "set_flag_state",
  permission: "flags:edit",
  input: z.object({
    flagId,
    env: z.enum(ENVS),
    enabled: onOff,
    rollout,
    // The state the user saw when submitting. `fromVersion` bumps on every write, so a change made against an
    // older view (e.g. a prod request that waited while the kill switch fired) is refused, even if the
    // values have since returned to what the user saw.
    fromEnabled: onOff,
    fromRollout: rollout,
    fromVersion: z.coerce.number().int().min(0),
  }),
  target: (i) => `flags_flag:${i.flagId}`,
  approval: {
    // Validate before queueing so approvers never see a no-op or already-stale request; run() re-checks on approval.
    required: (i) => {
      if (i.env !== "prod") return false;
      checkChange(i);
      return true;
    },
    approverPermission: "flags:approve_prod",
    summary: ({ flagId, enabled, rollout, fromEnabled, fromRollout }) =>
      `Prod change for flag ${getFlagRow(flagId)?.key ?? `#${flagId}`}: ${fmt(fromEnabled === "on", fromRollout)} → ${fmt(enabled === "on", enabled === "on" ? rollout : 0)}`,
  },
  run: (i, ctx) => {
    const { f, cur, enabled, pct } = checkChange(i);
    db().prepare("UPDATE flags_states SET enabled = ?, rollout = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE flag_id = ? AND env = ?")
      .run(enabled ? 1 : 0, pct, ctx.user.id, new Date().toISOString(), i.flagId, i.env);
    ctx.record({ env: i.env, before: { enabled: cur.enabled === 1, rollout: cur.rollout }, after: { enabled, rollout: pct } });
    return `${f.key} is now ${fmt(enabled, pct)} in ${i.env}${ctx.approvedBy ? ` (approved by ${ctx.approvedBy.name})` : ""}.`;
  },
});

export const killSwitch = defineAction({
  app: "flags",
  name: "kill_switch",
  permission: "flags:kill",
  input: z.object({ flagId }),
  target: (i) => `flags_flag:${i.flagId}`,
  run: ({ flagId }, ctx) => {
    const f = loadFlag(flagId);
    const cur = getStateRow(flagId, "prod");
    if (!cur || cur.enabled === 0) throw new ActionError(`${f.key} is already off in prod.`);
    db().prepare("UPDATE flags_states SET enabled = 0, rollout = 0, version = version + 1, updated_by = ?, updated_at = ? WHERE flag_id = ? AND env = 'prod'")
      .run(ctx.user.id, new Date().toISOString(), flagId);
    ctx.record({ env: "prod", breakGlass: true, before: { enabled: true, rollout: cur.rollout }, after: { enabled: false, rollout: 0 } });
    return `Killed ${f.key}: off in prod.`;
  },
});
