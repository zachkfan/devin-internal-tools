import { redirect } from "next/navigation";
import { writeAudit } from "./audit";
import { requireUser, type User } from "./auth";
import { can } from "./rbac";

/** Call at the top of every app page. Denied page views are audited. */
export async function requireAccess(permission: string): Promise<User> {
  const user = await requireUser();
  if (!can(user, permission)) {
    writeAudit({ actorId: user.id, app: permission.split(":")[0], action: "page_view", outcome: "denied", details: { permission } });
    redirect(`/forbidden?permission=${encodeURIComponent(permission)}`);
  }
  return user;
}
