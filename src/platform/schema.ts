import type { DatabaseSync } from "node:sqlite";
import type { Role } from "./roles";

export const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  app TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  details TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(target);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  target TEXT,
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  request_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','failed')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_reason TEXT
);
`;

const USERS: { id: string; name: string; title: string; roles: Role[] }[] = [
  { id: "ana", name: "Ana Ruiz", title: "KYC Analyst", roles: ["kyc_analyst"] },
  { id: "omar", name: "Omar Haddad", title: "Ops Manager", roles: ["ops_manager"] },
  { id: "priya", name: "Priya Shah", title: "Ops Manager", roles: ["ops_manager"] },
  { id: "sam", name: "Sam Lee", title: "Support Agent", roles: ["support_agent"] },
  { id: "erin", name: "Erin Walsh", title: "Software Engineer", roles: ["engineer"] },
  { id: "lee", name: "Lee Chen", title: "Engineering Lead", roles: ["engineer", "eng_lead"] },
  { id: "cora", name: "Cora Diaz", title: "Compliance Officer", roles: ["compliance"] },
];

export function seedPlatform(conn: DatabaseSync) {
  const user = conn.prepare("INSERT OR IGNORE INTO users (id, name, email, title) VALUES (?, ?, ?, ?)");
  const role = conn.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)");
  for (const u of USERS) {
    user.run(u.id, u.name, `${u.id}@example-fintech.test`, u.title);
    for (const r of u.roles) role.run(u.id, r);
  }
}
