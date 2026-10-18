# devin-internal-tools

A proof of concept for a fintech's question: *can our engineers use Devin to build our internal tools instead of paying for Microsoft Power Apps?*

It is **not** three one-off apps. It's a small **paved road**: a shared platform layer that gives every internal tool sign-in, role-based access, an append-only audit log, maker-checker approvals and PII masking for free. A Devin skill and CI guardrails then let Devin add tool #N from a short spec, without each new tool re-solving (or forgetting) the security basics.

## Quick start

```bash
npm ci          # Node >= 22.13 (uses the built-in node:sqlite; no native deps)
npm run dev     # http://localhost:3000. The DB is created and seeded automatically in ./data
npm run check   # typecheck + platform tests + guardrail tests
```

Sign in as any persona (dev-only login; production would use Entra ID SSO):

| Persona | Role | Try this |
|---|---|---|
| Ana | KYC Analyst | Claim a KYC case, reveal an SSN (asks for a reason), approve a **high-risk** case → it goes to Approvals instead |
| Omar / Priya | Ops Manager | Approve Ana's request in **Approvals**. Try approving your own request (blocked: four-eyes) |
| Sam | Support Agent | Open `/apps/kyc` → denied, and the denial is audited |
| Cora | Compliance | **Audit log**: every action, denial, PII reveal and approval, with hash-chain verification |
| Erin / Lee | Engineer / Eng Lead | Feature-flag admin (once that PR lands) |

## How it maps to what Power Apps gives you

| Power Apps / Power Platform | Here | Gap to production |
|---|---|---|
| Entra ID sign-in | Signed session cookie + persona picker | Swap in OIDC against Entra ID; map Entra groups to `roles.ts` |
| Dataverse security roles | `roles.ts` + per-app permissions in each manifest, checked server-side in every action and page | No row-level scoping yet (e.g. "only my region's cases") |
| Dataverse auditing | `audit_log`: append-only (DB triggers), SHA-256 hash chain, reason required on sensitive actions, denials logged | Stream to WORM storage / SIEM; retention policy |
| Power Automate approvals | Generic maker-checker on any action (`approval: { required, approverPermission }`), shared inbox, four-eyes enforced, executes atomically on approval | Notifications (Slack/Teams/email), SLAs, multi-step chains |
| Column security / masking | `mask()` applied in each app's query layer; raw values only via an audited reveal action | Field-level encryption at rest |
| DLP policies, managed environments | `tests/guardrails.test.ts` fails CI if an app bypasses the platform (raw server actions, direct DB writes, unguarded pages, un-namespaced permissions); CODEOWNERS on `src/platform/` | Branch protection, SAST, dependency scanning |
| Canvas app builder | Shared UI kit (`src/platform/ui`) + Devin writes the app from a spec | No drag-and-drop: non-engineers can't build tools themselves |
| 1,000+ connectors | SQLite only | Postgres + real integrations (payment processor, KYC vendor, flag service) |
| Microsoft-hosted, SOC/ISO/PCI attested | Runs anywhere Node runs | You own hosting, patching, on-call, pen-tests and compliance evidence |

## Adding a tool with Devin

1. Write a spec in `specs/<id>.md`. A paragraph is enough (see `specs/chargebacks.md`).
2. Start a Devin session (Cloud or CLI): *"Use the new-internal-tool skill to build `specs/<id>.md`."*
3. Devin follows `.agents/skills/new-internal-tool/SKILL.md`: it reads the KYC reference app, creates `src/app/apps/<id>/`, writes tests, runs `npm run check` + `npm run build`, clicks through as several personas, and opens one PR.
4. CI runs the guardrails. CODEOWNERS means anything touching `src/platform/` needs platform-owner review. App PRs only touch their own folder plus two registry lines.

## Layout

```
src/platform/            the paved road (auth, rbac, audit, approvals, pii, defineAction, ui kit)
src/app/apps/<id>/       one internal tool: _app/{manifest,queries,actions}.ts + pages
src/app/{approvals,audit,login}/   shared platform pages
tests/guardrails.test.ts structural rules every app must pass
tests/platform.test.ts   behaviour of RBAC, audit, maker-checker, PII
.agents/skills/new-internal-tool/  the Devin playbook for adding a tool
specs/                   specs handed to Devin
```

## What this is not

A prototype built in about 2 hours. Not production-ready: no real SSO, SQLite instead of Postgres, no deployment, no notifications, no row-level security, no rate limiting, no load testing.
See the build-vs-buy write-up for what it would take to close those gaps, and whether you should.

## Build log

| App | Built by | Wall-clock | Human interventions | PR |
|---|---|---|---|---|
| Platform core + KYC reference app | Devin CLI (local), steered by an engineer | ~15 min | n/a (pair-programmed) | initial commit |
| Refunds | Devin Cloud, `specs/refunds.md` | TBD | TBD | TBD |
| Feature flags | Devin Cloud, `specs/flags.md` | TBD | TBD | TBD |
| Chargebacks (new, one-paragraph spec) | Devin Cloud, `specs/chargebacks.md` | TBD | TBD | TBD |
