import { defineApp } from "@/platform/app";

export const ENVS = ["dev", "staging", "prod"] as const;
export type Env = (typeof ENVS)[number];

export const manifest = defineApp({
  id: "flags",
  name: "Feature Flag Admin",
  description:
    "See every feature flag across dev, staging and prod. Engineers create and change flags; dev and staging apply immediately, prod changes need an Engineering Lead's approval. The prod kill switch is break-glass and applies instantly.",
  readPermission: "flags:read",
  permissions: {
    "flags:read": { description: "View flags and their state in every environment", roles: ["engineer", "eng_lead", "ops_manager"] },
    "flags:edit": { description: "Create flags; change enabled / rollout % (prod changes need approval)", roles: ["engineer", "eng_lead"] },
    "flags:approve_prod": { description: "Second approver for any prod flag change", roles: ["eng_lead"] },
    "flags:kill": { description: "Kill switch: turn a flag off in prod immediately (audited)", roles: ["engineer", "eng_lead"] },
  },
  schema: `
    CREATE TABLE IF NOT EXISTS flags_flags (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 3 AND 64),
      description TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flags_states (
      flag_id INTEGER NOT NULL REFERENCES flags_flags(id),
      env TEXT NOT NULL CHECK (env IN ('dev','staging','prod')),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      rollout INTEGER NOT NULL DEFAULT 0 CHECK (rollout BETWEEN 0 AND 100),
      updated_by TEXT REFERENCES users(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (flag_id, env),
      CHECK (enabled = 1 OR rollout = 0)
    );`,
  seed(conn) {
    // Synthetic flags. Each state is [enabled, rollout %] for dev, staging, prod.
    type S = [0 | 1, number];
    const flags: [string, string, string, S, S, S][] = [
      ["new_onboarding_flow", "Redesigned 4-step signup with inline KYC document capture", "growth", [1, 100], [1, 100], [1, 25]],
      ["instant_payouts", "Push-to-card instant payouts for eligible merchants", "payments", [1, 100], [1, 100], [1, 100]],
      ["card_controls_v2", "Per-merchant-category spend limits and card freeze in the app", "cards", [1, 100], [1, 50], [0, 0]],
      ["ach_same_day", "Offer same-day ACH for transfers submitted before cutoff", "payments", [1, 100], [1, 100], [1, 10]],
      ["fraud_score_v3", "Shadow-score transactions with the v3 fraud model", "risk", [1, 100], [1, 100], [1, 100]],
      ["dark_mode", "Dark theme in the customer web app", "web-platform", [1, 100], [0, 0], [0, 0]],
      ["virtual_cards_bulk_issue", "Bulk-issue virtual cards from the business dashboard", "cards", [1, 30], [0, 0], [0, 0]],
      ["statement_pdf_v2", "New PDF renderer for monthly statements (killed after layout bug)", "core-banking", [1, 100], [1, 100], [0, 0]],
      ["referral_bonus_2026", "Double referral bonus campaign", "growth", [0, 0], [0, 0], [0, 0]],
      ["crypto_waitlist", "Show the crypto trading waitlist banner", "growth", [1, 100], [1, 100], [1, 5]],
      ["legacy_ledger_writes", "Dual-write to the legacy ledger during migration", "core-banking", [0, 0], [1, 100], [1, 100]],
    ];
    const flag = conn.prepare("INSERT INTO flags_flags (key, description, owner, created_by, created_at) VALUES (?, ?, ?, ?, ?)");
    const state = conn.prepare("INSERT INTO flags_states (flag_id, env, enabled, rollout, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    flags.forEach(([key, description, owner, ...states], i) => {
      const createdBy = i % 3 === 0 ? "lee" : "erin";
      const created = new Date(Date.now() - (i + 2) * 6 * 86400_000).toISOString();
      const id = Number(flag.run(key, description, owner, createdBy, created).lastInsertRowid);
      states.forEach(([enabled, rollout], j) => {
        const updated = new Date(Date.now() - (i + 1) * (3 - j) * 3600_000 * 7).toISOString();
        state.run(id, ENVS[j], enabled, rollout, createdBy, updated);
      });
    });
  },
});
