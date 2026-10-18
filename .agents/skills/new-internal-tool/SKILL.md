---
name: new-internal-tool
description: Build a new internal tool on the platform from a short spec (one app folder, tests, one PR). Use when asked to add an internal app, admin panel, queue, or dashboard.
argument-hint: "<path to spec, e.g. specs/refunds.md>"
---

# Build a new internal tool on the paved road

You are adding ONE internal tool to this repo from a spec (usually `specs/<id>.md`). The platform already provides
auth, RBAC, audit logging, maker-checker approvals, PII masking and UI components. Your job is the app-specific
part only. Done means: one PR, `npm run check` + `npm run build` green, and the app clicked through in a browser.

## 0. Read first (don't skip)
- `AGENTS.md` (hard rules + architecture)
- The reference app: `src/app/apps/kyc/_app/{manifest,queries,actions,tones}.ts`, `src/app/apps/kyc/page.tsx`, `src/app/apps/kyc/[id]/page.tsx`
- `src/platform/action.ts` (the `ActionDef` type, especially `approval`, `target`, `requireReason`), `src/platform/ui/*`
- `tests/platform.test.ts` (test style to copy)

## 1. Design (write this into the PR description later)
From the spec, decide:
- `id` (short, lowercase, e.g. `refunds`). This is the folder name, URL, permission prefix and table prefix.
- Tables (`<id>_*`), money in integer cents, statuses as CHECK constraints.
- Permissions `<id>:<verb>` mapped to EXISTING roles in `src/platform/roles.ts`. Least privilege: a read permission, then separate permissions for each risky verb.
- Which actions need a second approver (`approval.required`) and which permission approves them.
- Which fields are PII (mask them in `queries.ts`; add an audited reveal action only if the spec needs it).
If the spec is ambiguous, pick the safer, simpler option and list it under "Assumptions" in the PR. Don't ask and wait.

## 2. Build
1. `src/app/apps/<id>/_app/manifest.ts`: `defineApp({...})` with permissions, schema, and a realistic synthetic seed (8-15 rows, varied statuses, some edge cases like over-threshold amounts).
2. `src/app/apps/<id>/_app/queries.ts`: read-only functions returning typed, masked view models. No `.run(`/`.exec(`.
3. `src/app/apps/<id>/_app/actions.ts`: `"use server"`; every export is `defineAction({ app: "<id>", name, permission, input: z.object(...), target, approval?, run })`.
   - `run()` re-validates invariants (status transitions, amounts) because approvals execute later. Throw `ActionError` for user-facing errors.
   - Use `ctx.record({ before, after })`. No raw PII in audit details.
4. `src/app/apps/<id>/page.tsx` (list/dashboard) and `[id]/page.tsx` (detail) if needed. Start each with `await requireAccess(manifest.readPermission)`.
   Use `PageHeader`, `Stat`, `Tabs`, `DataTable`, `Badge`, `Card`, `KeyValue`, `ActionForm`, `ApprovalStatus`, `AuditTrail`. Hide action forms
   the user can't use (`can(user, perm)`). The server still enforces permissions either way.
5. Register: add the manifest to `src/platform/registry.ts` and `import * as <id>` to `src/platform/action-index.ts`. These two lines are the
   only platform edits allowed. If you believe the platform needs a change, don't make it: describe it under "Platform change proposals" in the PR.

## 3. Test
Create `tests/apps/<id>.test.ts` (copy the setup in `tests/platform.test.ts`: `beforeEach(resetDbForTests)`, `action.invoke(user, input, reason)`):
- a user without the permission is denied, and the denial is audited
- the happy path mutates data and writes an audit entry with the reason
- every approval rule: under threshold executes immediately; over threshold creates a request, the requester can't approve it, the right approver can
- the key business invariants from the spec (e.g. can't refund more than the transaction amount, even via an approved request)
Personas: ana (kyc_analyst), omar + priya (ops_manager), sam (support_agent), erin (engineer), lee (engineer + eng_lead), cora (compliance).

## 4. Verify
- `npm run check` must pass (includes `tests/guardrails.test.ts`; if a guardrail fails, fix your app, never the guardrail).
- `npm run build` must pass.
- `npm run dev`, then in the browser sign in as at least two personas: one who performs the main action, one who approves it (if applicable),
  and one without access (should be redirected to /forbidden). Take screenshots of the main page, the approvals inbox, and the audit trail.

## 5. Open the PR
Title: `feat(<id>): <App name>`. Body sections:
- Summary (what the tool does, 3 bullets)
- Permissions table (permission → roles → what it allows)
- Approval rules (what needs a second person, and who)
- PII handling
- Assumptions / deviations from the spec
- Platform change proposals (or "none")
- Test evidence: `npm run check` summary + screenshots
Keep it to ONE PR touching only `src/app/apps/<id>/**`, `tests/apps/<id>.test.ts`, and the two registry lines.
