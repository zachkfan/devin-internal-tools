# AGENTS.md: Internal Tools Platform

A paved road for building a fintech's internal tools (KYC, refunds, feature flags, and the next ten). One Next.js app; every tool is a folder under `src/app/apps/<id>/` built on shared platform primitives. To add a tool, follow the skill at `.agents/skills/new-internal-tool/SKILL.md`.

## Commands
- Install: `npm ci` (Node >= 22.13; CI uses Node 24)
- Dev server: `npm run dev` then open http://localhost:3000 and sign in as a persona
- Verify everything: `npm run check` (typecheck + all tests). Must pass before any PR.
- Production build: `npm run build`
- Reset local DB (re-seeds on next start): `npm run db:reset`

## Architecture (read before writing code)
- `src/platform/`: the platform. Owned by the platform team (CODEOWNERS). Don't change it in an app PR, apart from adding your app to `registry.ts` and `action-index.ts`.
  - `action.ts`: `defineAction()` is the ONLY way to change data. It enforces sign-in, RBAC, zod validation, a required reason, optional maker-checker approval, and runs the mutation and its audit entry in one transaction.
  - `approvals.ts`: maker-checker engine plus the shared `/approvals` inbox. Four-eyes is enforced: the requester can never approve.
  - `audit.ts`: append-only, hash-chained audit log, shown at `/audit`.
  - `rbac.ts`, `roles.ts`, `auth.ts`, `guard.ts`: roles, permissions, session, and the `requireAccess()` page guard.
  - `pii.ts`: `mask()`. PII is masked in each app's `queries.ts`. Raw values only come back through an audited reveal action.
  - `ui/`: `ActionForm`, `RevealField`, `DataTable`, `Badge`, `Card`, `Stat`, `Tabs`, `KeyValue`, `PageHeader`, `AuditTrail`, `ApprovalStatus`.
- `src/app/apps/<id>/`: one internal tool.
  - `_app/manifest.ts`: id, name, description, permissions (and which roles get them), schema DDL, synthetic seed.
  - `_app/queries.ts`: read-only data access. Returns masked PII.
  - `_app/actions.ts`: `"use server"`. Every export is a `defineAction(...)`.
  - `page.tsx` (+ `[id]/page.tsx`): server components. Call `requireAccess()` first.
- Reference implementation: `src/app/apps/kyc/`. Copy its patterns.

## Hard rules (enforced by `tests/guardrails.test.ts`; fix the app, never the guardrail)
1. Mutations happen only inside `defineAction` `run()` in `_app/actions.ts`. Pages and queries are read-only (no `.run(` / `.exec(`).
2. `"use server"` appears only in `_app/actions.ts`.
3. Permissions are `<appId>:<verb>`, declared in the manifest, granted only to roles in `src/platform/roles.ts`. Don't add roles in an app PR.
4. Tables are `<appId>_<name>`, created with `CREATE TABLE IF NOT EXISTS`. Schemas are additive only.
5. Apps never touch `audit_log` / `approval_requests` or call `writeAudit` directly.
6. Every `page.tsx` under `src/app/apps/` calls `requireAccess(...)`.
7. Seed data is synthetic. No real names, emails, card numbers or SSNs (use the 900-series for SSNs).

## Conventions
- `run()` is synchronous (node:sqlite) and must re-check business invariants: approved requests execute later, against current data.
- FormData values are strings, so use `z.coerce.number()` in action inputs. Money is integer cents.
- Use `ctx.record({ before, after })` for audit detail. Never record raw PII.
- Throw `ActionError("message")` for expected business errors; the user sees the message.
- Tailwind for styling; reuse `src/platform/ui` components before writing new ones.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
