import type { PermissionSpec } from "./app";
import type { User } from "./auth";
import { apps } from "./registry";
import type { Role } from "./roles";

export const PLATFORM_PERMISSIONS: Record<string, PermissionSpec> = {
  "platform:audit_read": { description: "View the global audit log", roles: ["compliance", "eng_lead"] },
};

export function allPermissions(): Record<string, PermissionSpec> {
  return Object.assign({}, PLATFORM_PERMISSIONS, ...apps.map((a) => a.permissions));
}

export function permissionsFor(roles: Role[]): Set<string> {
  const granted = new Set<string>();
  for (const [perm, spec] of Object.entries(allPermissions())) {
    if (spec.roles.some((r) => roles.includes(r))) granted.add(perm);
  }
  return granted;
}

/** Deny by default: unknown permissions are never granted. */
export const can = (user: User, permission: string) => permissionsFor(user.roles).has(permission);
