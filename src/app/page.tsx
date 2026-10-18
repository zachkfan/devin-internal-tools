import Link from "next/link";
import { appHref } from "@/platform/app";
import { pendingFor } from "@/platform/approvals";
import { requireUser } from "@/platform/auth";
import { can } from "@/platform/rbac";
import { apps } from "@/platform/registry";
import { PageHeader } from "@/platform/ui/primitives";

export default async function Home() {
  const user = await requireUser();
  const visible = apps.filter((a) => can(user, a.readPermission));
  const pending = pendingFor(user).length;
  return (
    <>
      <PageHeader title={`Hi, ${user.name.split(" ")[0]}`} description="Every app here shares one sign-in, one permission model, one audit log and one approvals inbox." />
      {pending > 0 && (
        <Link href="/approvals" className="mb-6 block rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {pending} request{pending > 1 ? "s" : ""} waiting for your approval →
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((a) => (
          <Link key={a.id} href={appHref(a.id)} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-400">
            <div className="font-semibold text-slate-900">{a.name}</div>
            <p className="mt-1 text-sm text-slate-500">{a.description}</p>
          </Link>
        ))}
      </div>
      {visible.length < apps.length && (
        <p className="mt-6 text-xs text-slate-400">{apps.length - visible.length} other app(s) hidden: your role doesn&apos;t grant access.</p>
      )}
    </>
  );
}
