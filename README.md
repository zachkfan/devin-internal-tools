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
| Sam | Support Agent | **Refunds:** $100 executes immediately, $1,200 goes to Approvals. **Chargebacks:** add evidence, then contest a dispute over $1,000. Open `/apps/kyc` → denied, and the denial is audited |
| Cora | Compliance | **Audit log**: every action, denial, PII reveal and approval, with hash-chain verification |
| Erin / Lee | Engineer / Eng Lead | **Feature flags:** a dev change applies immediately; a prod change waits for Lee; the kill switch is instant (break-glass, audited) |

## How it maps to what Power Apps gives you

Checked against Microsoft Learn docs (October 2026). "Stronger" or "weaker" here means relative to that one control, not overall.

| Power Platform capability | Here | Where this is stronger | Where Power Platform is stronger / gap to production |
|---|---|---|---|
| Entra ID sign-in (MFA, conditional access, IP cookie binding) | Signed session cookie + persona picker | n/a | Everything. Needs OIDC against Entra ID, with Entra groups mapped to `roles.ts` |
| Dataverse security roles: 8 privileges × 5 access levels, business units, teams, record sharing, hierarchy security | `roles.ts` + business-verb permissions per app (`refunds:approve_large`), checked server-side on every action and page, deny by default, denials audited | Business-level verbs are first-class instead of table CRUD | **No row-level scoping** (own records / business unit), no teams, no record sharing |
| Dataverse auditing: automatic field-level old/new values, retention up to forever, Purview for read logging | `audit_log`: append-only (DB triggers), SHA-256 hash chain, required reason, denials + PII reveals + approvals logged | Captures *why* (reason) and denied attempts; tamper-evident. Dataverse admins can delete audit logs (the deletion is audited) | **Before/after values are opt-in per action, not automatic.** No retention policy, export, or SIEM streaming |
| Power Automate approvals: 4 approval types, sequential stages, delegation, email/Teams/mobile | Generic maker-checker on any action, shared inbox | Four-eyes enforced by the platform (Power Automate needs per-flow logic); approve + execute is one transaction and re-checks business rules | Single approver, single stage, **no notifications**, no delegation or timeouts |
| Column security + masking rules: read / read-unmasked (one or all records) / create / update per column | `mask()` in each app's query layer; reveal is an action that needs a permission and an audited reason | A justification is mandatory for each reveal | **Masking is a code convention, not enforced at the data layer.** Dataverse enforces it in the API |
| DLP data policies, Managed Environments (sharing limits, pipelines, CMK, Lockbox, IP firewall, VNet, backups) | `tests/guardrails.test.ts` fails CI if an app bypasses the platform; CODEOWNERS on `src/platform/` | Every change is code-reviewed and tested before it ships | **No runtime controls:** egress/DLP, CMK, backups and dev/test/prod environments become your infra work |
| Canvas / model-driven builder, Power Fx, Copilot | Shared UI kit + Devin writes the app from a spec | Full customization | No drag-and-drop: non-engineers can't build tools themselves |
| 1,000+ connectors, on-prem gateway | SQLite only | n/a | Postgres + real integrations (payment processor, KYC vendor, flag service) |
| Microsoft-hosted; Power Apps/Automate in scope of Microsoft SOC 1/2/3, ISO 27001, PCI DSS, SOX attestations | Runs anywhere Node runs | No per-user licence | You own hosting, patching, on-call, pen-tests and the compliance evidence |

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

The three cloud sessions were started in parallel from the web app between about 01:50 and 01:57 (EDT), each with a two-sentence prompt pointing at its spec and the skill.

| App | Built by | First PR opened | Human messages to the session | Devin Review | Merged |
|---|---|---|---|---|---|
| Platform core + KYC reference app | Devin CLI (local), pair-programmed | 01:26 (clock started 01:15) | n/a | n/a | initial commit |
| Refunds | Devin Cloud, `specs/refunds.md` | 01:59 (#1) | 1 scope addition: "add sorting and filtering" | 2 minor findings (sub-cent amounts, LIKE wildcards). The session fixed both in the same minute, unprompted | 02:27 |
| Feature flags | Devin Cloud, `specs/flags.md` | 02:01 (#2) | 1 coordination: "fix the merge conflict" | 2 🔴 upgrade-path findings (a column and payload field added mid-PR break databases created before that change; moot here since that schema never reached `main`) + 1 🟡 (success message lost after a dev/staging change). **Not addressed before merge** | 02:37 |
| Chargebacks (new, one-paragraph spec) | Devin Cloud, `specs/chargebacks.md` | 02:04 (#3) | 1 scope addition: "match the refunds sort/filter" | 1 🟥 security finding (evidence-note text could reach the audit log on failure). The session had already closed the main path; it replied with an assessment and escalated the remaining case as a platform proposal | 02:33 |
| Platform follow-ups: approvals confirmation (bug reported by the refunds session) + `redact` option for audit entries (escalated by the chargebacks session) | Devin CLI (local), platform owner's request | via PR | n/a | n/a | this change |

- **Human messages that fixed a Devin mistake: 0.** All three messages were scope additions or merge coordination.
- **Shared core touched by app PRs:** only the two registration lines. Guardrail tests, platform tests, dependencies and CI were unchanged across about 20 Devin commits.
- **Parallel sessions conflict on the shared registration files.** The sessions resolved this themselves; generating the registry from the app folders would remove it.
- **Two PRs were merged with Devin Review findings still open.** The tooling surfaced them; a human merged anyway. Review findings need to block merges (branch protection), not just inform them.
- **Gaps in the platform that the sessions exposed:**
  - No schema-migration mechanism. Schemas are `CREATE TABLE IF NOT EXISTS`, so adding a column to an existing app needs versioned migrations.
  - `defineAction` audited the full input on unexpected errors. **Fixed:** actions can now declare `redact: ["field"]`, and chargebacks uses it for evidence notes.
  - The mandatory "reason" is free text visible to audit readers, so a "no customer PII in reasons" policy is needed.
