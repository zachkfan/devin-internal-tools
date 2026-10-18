"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./action";
import { decide, getRequest } from "./approvals";
import { writeAudit } from "./audit";
import { currentUser, devLoginAllowed, getUser, requireUser, SESSION_COOKIE, signSession } from "./auth";

export async function loginAs(formData: FormData) {
  if (!devLoginAllowed()) throw new Error("Persona login is disabled in production. Use SSO.");
  const user = getUser(String(formData.get("userId")));
  if (!user) throw new Error("Unknown user");
  (await cookies()).set(SESSION_COOKIE, signSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8,
  });
  writeAudit({ actorId: user.id, app: "platform", action: "login", outcome: "success", details: { method: "dev-persona" } });
  redirect("/");
}

export async function logout() {
  const user = await currentUser();
  if (user) writeAudit({ actorId: user.id, app: "platform", action: "logout", outcome: "success" });
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function decideApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const decision = formData.get("decision") === "approve" ? "approve" : "reject";
  const requestId = Number(formData.get("requestId"));
  const state = decide(user, requestId, decision, String(formData.get("reason") ?? ""));
  const req = getRequest(requestId);
  if (req && req.status !== "pending" && req.decided_by === user.id) {
    revalidatePath("/", "layout");
    redirect(`/approvals?decided=${req.id}`);
  }
  return { ...state!, at: Date.now() };
}
