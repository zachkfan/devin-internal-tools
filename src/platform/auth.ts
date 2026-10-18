import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import type { Role } from "./roles";

export type User = { id: string; name: string; email: string; title: string; roles: Role[] };

export const SESSION_COOKIE = "dit_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return s ?? "dev-only-insecure-secret";
}

const sign = (userId: string) => createHmac("sha256", secret()).update(userId).digest("base64url");

export const signSession = (userId: string) => `${userId}.${sign(userId)}`;

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const userId = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

/** Persona login exists only for local dev/demo. Production identity comes from Entra ID (OIDC). */
export const devLoginAllowed = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_LOGIN === "1";

export function getUser(id: string): User | null {
  const row = db().prepare("SELECT id, name, email, title FROM users WHERE id = ?").get(id) as Omit<User, "roles"> | undefined;
  if (!row) return null;
  const roles = (db().prepare("SELECT role FROM user_roles WHERE user_id = ?").all(id) as { role: Role }[]).map((r) => r.role);
  return { ...row, roles };
}

export function listUsers(): User[] {
  const ids = db().prepare("SELECT id FROM users ORDER BY rowid").all() as { id: string }[];
  return ids.map((r) => getUser(r.id)!);
}

export async function currentUser(): Promise<User | null> {
  const { cookies } = await import("next/headers");
  const id = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? getUser(id) : null;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return user!;
}
