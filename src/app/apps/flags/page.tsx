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

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const { view: raw } = await searchParams;
  const view: View = raw && raw in VIEWS ? (raw as View) : "all";
  const all = listFlags();
  const live = all.filter((f) => f.liveInProd);
  const rows = view === "live" ? live : view === "off" ? all.filter((f) => !f.liveInProd) : all;
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
          <Tabs active={view} tabs={(Object.keys(VIEWS) as View[]).map((k) => ({ key: k, label: VIEWS[k], href: `/apps/flags?view=${k}`, count: counts[k] }))} />
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
