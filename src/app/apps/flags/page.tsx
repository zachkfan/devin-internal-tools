import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { Badge, Card, DataTable, PageHeader, Stat, Tabs } from "@/platform/ui/primitives";
import { createFlag } from "./_app/actions";
import { manifest } from "./_app/manifest";
import { ENVS, listFlags, type Flag } from "./_app/queries";
import { ENV_LABEL, stateLabel, stateTone } from "./_app/tones";

const VIEWS = { all: "All flags", live: "On in prod", off: "Off in prod" } as const;
type View = keyof typeof VIEWS;
const SORTS = { key: "Key (A–Z)", updated: "Recently changed", created: "Newest first", rollout: "Prod rollout (high–low)" } as const;
type Sort = keyof typeof SORTS;

const lastChange = (f: Flag) => ENVS.map((e) => f.states[e].updatedAt).sort().at(-1) ?? "";
const SORTERS: Record<Sort, (a: Flag, b: Flag) => number> = {
  key: (a, b) => a.key.localeCompare(b.key),
  updated: (a, b) => lastChange(b).localeCompare(lastChange(a)),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  rollout: (a, b) => b.states.prod.rollout - a.states.prod.rollout || a.key.localeCompare(b.key),
};

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ view?: string; sort?: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const { view: rawView, sort: rawSort } = await searchParams;
  const view: View = rawView && Object.hasOwn(VIEWS, rawView) ? (rawView as View) : "all";
  const sort: Sort = rawSort && Object.hasOwn(SORTS, rawSort) ? (rawSort as Sort) : "key";
  const all = listFlags();
  const live = all.filter((f) => f.liveInProd);
  const rows = (view === "live" ? live : view === "off" ? all.filter((f) => !f.liveInProd) : [...all]).sort(SORTERS[sort]);
  const counts: Record<View, number> = { all: all.length, live: live.length, off: all.length - live.length };

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Flags" value={all.length} />
        <Stat label="On in prod" value={live.length} tone="red" />
        <Stat label="Partial prod rollout" value={live.filter((f) => f.states.prod.rollout < 100).length} tone="yellow" />
        <Stat label="Staging only" value={all.filter((f) => f.states.staging.enabled && !f.liveInProd).length} tone="blue" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Tabs active={view} tabs={(Object.keys(VIEWS) as View[]).map((k) => ({ key: k, label: VIEWS[k], href: `/apps/flags?view=${k}&sort=${sort}`, count: counts[k] }))} />
            <form key={`${view}-${sort}`} method="get" className="mb-3 flex items-center gap-2 text-sm">
              <input type="hidden" name="view" value={view} />
              <label htmlFor="sort" className="text-slate-600">Sort</label>
              <select id="sort" name="sort" defaultValue={sort} className="rounded border border-slate-300 px-2 py-1">
                {(Object.keys(SORTS) as Sort[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
              </select>
              <button type="submit" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Apply</button>
            </form>
          </div>
          <DataTable<Flag>
            rows={rows}
            rowHref={(f) => `/apps/flags/${f.id}`}
            empty="No flags match."
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
