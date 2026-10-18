import Link from "next/link";
import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { Badge, Card, DataTable, PageHeader, Stat } from "@/platform/ui/primitives";
import { createFlag } from "./_app/actions";
import { manifest } from "./_app/manifest";
import { ENVS, listFlags, type Flag } from "./_app/queries";
import { ENV_LABEL, stateLabel, stateTone } from "./_app/tones";

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

const STATUSES = { live: "On in prod", off: "Off in prod", partial: "Partial prod rollout", staging: "Staging only" } as const;
type Status = keyof typeof STATUSES;
const STATUS_FILTER: Record<Status, (f: Flag) => boolean> = {
  live: (f) => f.liveInProd,
  off: (f) => !f.liveInProd,
  partial: (f) => f.liveInProd && f.states.prod.rollout < 100,
  staging: (f) => f.states.staging.enabled && !f.liveInProd,
};

const SORTS = {
  key_asc: "Key: A to Z",
  key_desc: "Key: Z to A",
  changed_desc: "Changed: newest first",
  changed_asc: "Changed: oldest first",
  created_desc: "Created: newest first",
  created_asc: "Created: oldest first",
  rollout_desc: "Prod rollout: high to low",
  rollout_asc: "Prod rollout: low to high",
} as const;
type Sort = keyof typeof SORTS;
const DEFAULT_SORT: Sort = "key_asc";

const lastChange = (f: Flag) => ENVS.map((e) => f.states[e].updatedAt).sort().at(-1) ?? "";
const byKey = (a: Flag, b: Flag) => a.key.localeCompare(b.key);
const SORTERS: Record<Sort, (a: Flag, b: Flag) => number> = {
  key_asc: byKey,
  key_desc: (a, b) => byKey(b, a),
  changed_desc: (a, b) => lastChange(b).localeCompare(lastChange(a)) || byKey(a, b),
  changed_asc: (a, b) => lastChange(a).localeCompare(lastChange(b)) || byKey(a, b),
  created_desc: (a, b) => b.createdAt.localeCompare(a.createdAt) || byKey(a, b),
  created_asc: (a, b) => a.createdAt.localeCompare(b.createdAt) || byKey(a, b),
  rollout_desc: (a, b) => b.states.prod.rollout - a.states.prod.rollout || byKey(a, b),
  rollout_asc: (a, b) => a.states.prod.rollout - b.states.prod.rollout || byKey(a, b),
};
const SELECT_CLASS = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ q?: Param; status?: Param; sort?: Param }> }) {
  const user = await requireAccess(manifest.readPermission);
  const params = await searchParams;
  const [q = "", rawStatus, rawSort] = [first(params.q), first(params.status), first(params.sort)];
  const status = rawStatus && Object.hasOwn(STATUSES, rawStatus) ? (rawStatus as Status) : undefined;
  const sort: Sort = rawSort && Object.hasOwn(SORTS, rawSort) ? (rawSort as Sort) : DEFAULT_SORT;
  const filtered = Boolean(q || status || sort !== DEFAULT_SORT);
  const all = listFlags();
  const live = all.filter(STATUS_FILTER.live);
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((f) => !status || STATUS_FILTER[status](f))
    .filter((f) => !needle || [f.key, f.owner, f.description].some((t) => t.toLowerCase().includes(needle)))
    .sort(SORTERS[sort]);

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Flags" value={all.length} />
        <Stat label="On in prod" value={live.length} tone="red" />
        <Stat label="Partial prod rollout" value={all.filter(STATUS_FILTER.partial).length} tone="yellow" />
        <Stat label="Staging only" value={all.filter(STATUS_FILTER.staging).length} tone="blue" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div>
          {/* Keyed so the uncontrolled inputs reset to the URL's values on client navigation (e.g. Clear). */}
          <form key={`${q}|${status ?? ""}|${sort}`} action="/apps/flags" className="mb-4 flex flex-wrap gap-2">
            <input name="q" defaultValue={q} placeholder="Search key, owner or description"
              className="w-full max-w-md rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
            <select name="status" defaultValue={status ?? ""} aria-label="Flag status" className={SELECT_CLASS}>
              <option value="">All statuses</option>
              {(Object.keys(STATUSES) as Status[]).map((s) => <option key={s} value={s}>{STATUSES[s]}</option>)}
            </select>
            <select name="sort" defaultValue={sort} aria-label="Sort by" className={SELECT_CLASS}>
              {(Object.keys(SORTS) as Sort[]).map((s) => <option key={s} value={s}>{SORTS[s]}</option>)}
            </select>
            <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
            {filtered && <Link href="/apps/flags" className="self-center text-sm text-blue-700 hover:underline">Clear</Link>}
          </form>
          <DataTable<Flag>
            rows={rows}
            rowHref={(f) => `/apps/flags/${f.id}`}
            empty={q || status ? "No flags match these filters." : "No flags."}
            columns={[
              {
                header: "Flag",
                cell: (f) => (
                  <span className="inline-flex items-center gap-2">
                    <code className={`text-xs ${f.liveInProd ? "font-semibold text-red-800" : ""}`}>{f.key}</code>
                    {f.liveInProd && <Badge tone="red">LIVE</Badge>}
                  </span>
                ),
              },
              ...ENVS.map((env) => ({
                header: ENV_LABEL[env],
                cell: (f: Flag) => <Badge tone={stateTone(env, f.states[env])}>{stateLabel(f.states[env])}</Badge>,
              })),
              { header: "Owner", cell: (f) => <span className="text-slate-600">{f.owner}</span> },
              { header: "Description", cell: (f) => <span className="text-xs text-slate-600">{f.description}</span> },
            ]}
          />
        </div>
        {can(user, "flags:edit") && (
          <Card title="Create flag">
            <ActionForm
              action={createFlag}
              fields={[
                { name: "key", label: "Key (snake_case)", placeholder: "new_checkout_flow" },
                { name: "description", label: "Description", type: "textarea" },
                { name: "owner", label: "Owner (team)", placeholder: "payments" },
              ]}
              submits={[{ label: "Create flag" }]}
            />
            <p className="mt-3 text-xs text-slate-500">New flags start off in every environment.</p>
          </Card>
        )}
      </div>
    </>
  );
}
