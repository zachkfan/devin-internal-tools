import Link from "next/link";
import type { ReactNode } from "react";
import { appHref } from "../app";
import { pendingFor } from "../approvals";
import type { User } from "../auth";
import { can } from "../rbac";
import { apps } from "../registry";
import { ROLES } from "../roles";
import { logout } from "../server-actions";

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const visible = apps.filter((a) => can(user, a.readPermission));
  const pending = pendingFor(user).length;
  const link = "block rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white";
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 p-3">
        <Link href="/" className="mb-4 px-3 py-2 text-base font-semibold text-white">Internal Tools</Link>
        <nav className="space-y-0.5">
          <Link href="/approvals" className={link}>
            Approvals {pending > 0 && <span className="ml-1 rounded bg-amber-500 px-1.5 text-xs text-slate-900">{pending}</span>}
          </Link>
          {can(user, "platform:audit_read") && <Link href="/audit" className={link}>Audit log</Link>}
          <div className="px-3 pb-1 pt-4 text-xs uppercase tracking-wide text-slate-500">Apps</div>
          {visible.map((a) => <Link key={a.id} href={appHref(a.id)} className={link}>{a.name}</Link>)}
        </nav>
        <div className="mt-auto border-t border-slate-700 px-3 pt-3 text-sm text-slate-300">
          <div className="font-medium text-white">{user.name}</div>
          <div className="text-xs text-slate-400">{user.roles.map((r) => ROLES[r]).join(", ")}</div>
          <form action={logout}><button className="mt-2 text-xs text-slate-400 hover:text-white">Switch user</button></form>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-8">{children}</main>
    </div>
  );
}
