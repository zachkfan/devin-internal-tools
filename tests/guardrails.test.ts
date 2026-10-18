// Guardrails: static + structural checks that every internal app stays on the paved road.
// These run in CI on every PR (human- or Devin-authored). If one fails, fix the app, not the test.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlatformAction } from "@/platform/action";
import { actionModules } from "@/platform/action-index";
import { PLATFORM_PERMISSIONS } from "@/platform/rbac";
import { apps } from "@/platform/registry";
import { ROLES } from "@/platform/roles";

const SRC = path.resolve(__dirname, "../src");
const APPS_DIR = path.join(SRC, "app/apps");
const appDirs = fs.readdirSync(APPS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
const rel = (p: string) => path.relative(SRC, p);
const read = (p: string) => fs.readFileSync(p, "utf8");
const appFiles = walk(APPS_DIR);
const isActionsFile = (p: string) => /app\/apps\/[^/]+\/_app\/actions\.ts$/.test(p);
const isManifest = (p: string) => /app\/apps\/[^/]+\/_app\/manifest\.ts$/.test(p);

describe("registration", () => {
  it("every app folder is registered in registry.ts and action-index.ts", () => {
    expect(apps.map((a) => a.id).sort()).toEqual([...appDirs].sort());
    expect(Object.keys(actionModules).sort()).toEqual([...appDirs].sort());
  });

  it("every app has manifest.ts, actions.ts and queries.ts in _app/", () => {
    for (const id of appDirs) {
      for (const f of ["manifest.ts", "actions.ts", "queries.ts"]) expect(fs.existsSync(path.join(APPS_DIR, id, "_app", f)), `${id}/_app/${f}`).toBe(true);
    }
  });
});

describe.each(apps)("app $id: manifest", (app) => {
  it("permissions are namespaced and only granted to known platform roles", () => {
    expect(Object.keys(app.permissions).length).toBeGreaterThan(0);
    expect(app.permissions).toHaveProperty(app.readPermission);
    for (const [perm, spec] of Object.entries(app.permissions)) {
      expect(perm.startsWith(`${app.id}:`), perm).toBe(true);
      expect(spec.roles.length, `${perm} grants no roles`).toBeGreaterThan(0);
      for (const r of spec.roles) expect(Object.keys(ROLES), `${perm} -> unknown role ${r}`).toContain(r);
    }
  });

  it("schema is additive and tables are namespaced", () => {
    expect(app.schema).not.toMatch(/\b(DROP|ALTER\s+TABLE\s+\w+\s+DROP)\b/i);
    const tables = [...app.schema.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t.startsWith(`${app.id}_`), `table ${t}`).toBe(true);
    expect(app.schema).not.toMatch(/CREATE TABLE\s+(?!IF NOT EXISTS)/i);
  });
});

describe.each(appDirs)("app %s: actions", (id) => {
  const app = apps.find((a) => a.id === id)!;
  const exportsOf = Object.entries(actionModules[id] ?? {});

  it("every export of _app/actions.ts is a defineAction() action (RBAC + audit + reason enforced)", () => {
    expect(exportsOf.length).toBeGreaterThan(0);
    for (const [name, value] of exportsOf) expect(isPlatformAction(value), `${id}/_app/actions.ts export "${name}"`).toBe(true);
  });

  it("actions use this app's namespace and declared permissions", () => {
    const names = new Set<string>();
    for (const [, value] of exportsOf) {
      if (!isPlatformAction(value)) continue;
      const { def } = value;
      expect(def.app).toBe(id);
      expect(names.has(def.name), `duplicate action name ${def.name}`).toBe(false);
      names.add(def.name);
      expect(app.permissions, `${def.name} uses undeclared ${def.permission}`).toHaveProperty(def.permission);
      if (def.approval) expect(app.permissions, `${def.name} approver`).toHaveProperty(def.approval.approverPermission);
    }
  });
});

describe("code boundaries", () => {
  const allSrc = walk(SRC);

  it("'use server' only appears in _app/actions.ts and platform/server-actions.ts", () => {
    const offenders = allSrc.filter((p) => /^\s*["']use server["']/m.test(read(p)) && !isActionsFile(p) && rel(p) !== "platform/server-actions.ts");
    expect(offenders.map(rel)).toEqual([]);
  });

  it("apps never write the audit log or approval tables directly", () => {
    const offenders = appFiles.filter((p) => /audit_log|approval_requests|writeAudit\(/.test(read(p)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("only actions (and manifest seeds) execute write statements; pages and queries are read-only", () => {
    const offenders = appFiles.filter((p) => !isActionsFile(p) && !isManifest(p) && /\.run\(|\.exec\(/.test(read(p)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("pages and components never import the database directly (use _app/queries.ts)", () => {
    const offenders = appFiles.filter((p) => !p.includes(`${path.sep}_app${path.sep}`) && /from ["']@\/platform\/db["']/.test(read(p)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("every app page is gated with requireAccess()", () => {
    const pages = appFiles.filter((p) => p.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((p) => !read(p).includes("requireAccess(")).map(rel)).toEqual([]);
  });

  it("platform permissions are namespaced", () => {
    for (const p of Object.keys(PLATFORM_PERMISSIONS)) expect(p.startsWith("platform:")).toBe(true);
  });
});
