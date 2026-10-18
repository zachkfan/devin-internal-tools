# Spec: Feature Flag Admin (`flags`)

Replaces the existing Power Apps "Feature-flag admin panel".

**Who:** Engineers create and change feature flags. Engineering leads approve production changes. Ops managers can view flags (to answer "is X on for customers?") but can't change them.

**What it does**
- Flag list as a matrix: one row per flag, one column per environment (`dev`, `staging`, `prod`). Each cell shows on/off and rollout percentage. Highlight flags that are on in prod. Seed about 10 realistic flags (e.g. `new_onboarding_flow`, `instant_payouts`, `card_controls_v2`), with an owner and description, in a mix of states.
- Create flag (key in snake_case, description, owner). New flags start off in every environment.
- Flag detail page: per-environment state with a form to change enabled/rollout %, any pending approval, and the audit trail for that flag.
- Kill switch: one button per flag that turns it off in prod immediately.

**Rules**
- Changing a flag in `dev` or `staging` applies immediately.
- Any change to `prod` (enable, disable, rollout change) needs a second person with `flags:approve_prod` (eng leads). The kill switch is the one exception: it's break-glass, applies instantly, still requires a reason, and is audited.
- Rollout percentage is an integer 0-100. A flag that's off has rollout 0.
- Permissions: `flags:read` (engineer, eng_lead, ops_manager), `flags:edit` (engineer, eng_lead), `flags:approve_prod` (eng_lead), `flags:kill` (engineer, eng_lead).

**Out of scope:** an SDK/API for services to read flags. The platform team will add a read API later.
