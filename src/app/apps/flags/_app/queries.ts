import { db } from "@/platform/db";
import { ENVS, type Env } from "./manifest";

export { ENVS, type Env };

/** What pages get. Flags hold no PII (owners are team handles), so nothing is masked. */
export type EnvState = { enabled: boolean; rollout: number; version: number; updatedBy: string | null; updatedAt: string };
export type Flag = {
  id: number; key: string; description: string; owner: string; createdBy: string; createdAt: string;
  states: Record<Env, EnvState>;
  liveInProd: boolean;
};

export type FlagRow = { id: number; key: string; description: string; owner: string; created_by: string; created_at: string };
export type StateRow = { flag_id: number; env: Env; enabled: 0 | 1; rollout: number; version: number; updated_by: string | null; updated_at: string };

const toState = (s: StateRow): EnvState => ({ enabled: s.enabled === 1, rollout: s.rollout, version: s.version, updatedBy: s.updated_by, updatedAt: s.updated_at });

function toFlag(r: FlagRow, states: StateRow[]): Flag {
  const byEnv = Object.fromEntries(
    ENVS.map((env) => {
      const s = states.find((x) => x.env === env);
      return [env, s ? toState(s) : { enabled: false, rollout: 0, updatedBy: null, updatedAt: r.created_at }];
    }),
  ) as Record<Env, EnvState>;
  return {
    id: r.id, key: r.key, description: r.description, owner: r.owner, createdBy: r.created_by, createdAt: r.created_at,
    states: byEnv, liveInProd: byEnv.prod.enabled,
  };
}

export function listFlags(): Flag[] {
  const flags = db().prepare("SELECT * FROM flags_flags ORDER BY key").all() as FlagRow[];
  const states = db().prepare("SELECT * FROM flags_states").all() as StateRow[];
  return flags.map((f) => toFlag(f, states.filter((s) => s.flag_id === f.id)));
}

export function getFlag(id: number): Flag | null {
  const row = getFlagRow(id);
  if (!row) return null;
  return toFlag(row, db().prepare("SELECT * FROM flags_states WHERE flag_id = ?").all(id) as StateRow[]);
}

/** Raw rows for use inside actions. */
export function getFlagRow(id: number): FlagRow | undefined {
  return db().prepare("SELECT * FROM flags_flags WHERE id = ?").get(id) as FlagRow | undefined;
}

export function getFlagByKey(key: string): FlagRow | undefined {
  return db().prepare("SELECT * FROM flags_flags WHERE key = ?").get(key) as FlagRow | undefined;
}

export function getStateRow(flagId: number, env: Env): StateRow | undefined {
  return db().prepare("SELECT * FROM flags_states WHERE flag_id = ? AND env = ?").get(flagId, env) as StateRow | undefined;
}
