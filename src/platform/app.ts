import type { DatabaseSync } from "node:sqlite";
import type { Role } from "./roles";

export type PermissionSpec = { description: string; roles: Role[] };

export type AppManifest = {
  /** URL slug and permission namespace, e.g. "kyc" -> /apps/kyc and "kyc:*" permissions. */
  id: string;
  name: string;
  description: string;
  /** Permission required to see the app in the nav and open its pages. */
  readPermission: string;
  /** Every permission the app uses, and which roles get it. Must be prefixed with `${id}:`. */
  permissions: Record<string, PermissionSpec>;
  /** Idempotent DDL (CREATE TABLE IF NOT EXISTS ...). Tables must be prefixed with `${id}_`. */
  schema: string;
  /** Synthetic seed data, run once per database. Never put real customer data here. */
  seed?: (conn: DatabaseSync) => void;
};

export function defineApp(manifest: AppManifest): AppManifest {
  return manifest;
}

export const appHref = (id: string) => `/apps/${id}`;
