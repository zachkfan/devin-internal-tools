import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apps } from "./registry";
import { PLATFORM_SCHEMA, seedPlatform } from "./schema";

const g = globalThis as unknown as { __platformDb?: DatabaseSync };

function migrate(conn: DatabaseSync) {
  conn.exec(PLATFORM_SCHEMA);
  const seeded = conn.prepare("SELECT 1 FROM meta WHERE key = ?");
  const mark = conn.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  if (!seeded.get("seeded:platform")) {
    seedPlatform(conn);
    mark.run("seeded:platform", new Date().toISOString());
  }
  for (const app of apps) {
    conn.exec(app.schema);
    if (app.seed && !seeded.get(`seeded:${app.id}`)) {
      app.seed(conn);
      mark.run(`seeded:${app.id}`, new Date().toISOString());
    }
  }
}

/** Shared SQLite connection. Swap for Postgres in production; the rest of the platform only uses this module. */
export function db(): DatabaseSync {
  if (!g.__platformDb) {
    const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrate(conn);
    g.__platformDb = conn;
  }
  return g.__platformDb;
}

/** Runs fn in a single transaction. Mutations and their audit entries commit or roll back together. */
export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** Test helper: drop the cached connection so the next db() call starts from a fresh database. */
export function resetDbForTests() {
  g.__platformDb?.close();
  g.__platformDb = undefined;
}
