import { devLoginAllowed, listUsers } from "@/platform/auth";
import { ROLES } from "@/platform/roles";
import { loginAs } from "@/platform/server-actions";

export default function LoginPage() {
  if (!devLoginAllowed()) return <p className="p-10">Sign in with SSO.</p>;
  return (
    <div className="mx-auto max-w-3xl p-10">
      <h1 className="text-2xl font-semibold">Internal Tools: sign in</h1>
      <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Dev-only persona login. In production this is replaced by Entra ID (OIDC) SSO, and roles come from Entra groups.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {listUsers().map((u) => (
          <form key={u.id} action={loginAs}>
            <input type="hidden" name="userId" value={u.id} />
            <button className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-400">
              <div className="font-medium">{u.name}</div>
              <div className="text-sm text-slate-500">{u.roles.map((r) => ROLES[r]).join(", ")}</div>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
