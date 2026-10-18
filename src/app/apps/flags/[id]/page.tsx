import Link from "next/link";
import { notFound } from "next/navigation";
import { approvalsForTarget } from "@/platform/approvals";
import { requireAccess } from "@/platform/guard";
import { can } from "@/platform/rbac";
import { ActionForm } from "@/platform/ui/ActionForm";
import { ApprovalStatus, AuditTrail } from "@/platform/ui/AuditTrail";
import { Badge, Card, KeyValue, PageHeader, fmtTime } from "@/platform/ui/primitives";
import { killSwitch, setFlagState } from "../_app/actions";
import { manifest } from "../_app/manifest";
import { ENVS, getFlag } from "../_app/queries";
import { ENV_LABEL, stateLabel, stateTone } from "../_app/tones";

export default async function FlagPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess(manifest.readPermission);
  const f = getFlag(Number((await params).id));
  if (!f) notFound();
  const target = `flags_flag:${f.id}`;
  const canEdit = can(user, "flags:edit");
  const canKill = can(user, "flags:kill");

  return (
    <>
      <Link href="/apps/flags" className="text-sm text-blue-700 hover:underline">← Back to flags</Link>
      <PageHeader
        title={f.key}
        description={f.description}
        actions={f.liveInProd ? <Badge tone="red">LIVE in prod · {f.states.prod.rollout}%</Badge> : <Badge>Off in prod</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <KeyValue items={[
            ["Key", <code key="k" className="text-xs">{f.key}</code>],
            ["Owner", f.owner],
            ["Created", `${f.createdBy} · ${fmtTime(f.createdAt)}`],
          ]} />
        </Card>
        <Card title="Kill switch">
          {!f.liveInProd ? (
            <p className="text-sm text-slate-500">Already off in prod.</p>
          ) : !canKill ? (
            <p className="text-sm text-slate-500">Read-only: you don&apos;t have flags:kill.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">Break-glass: turns <code className="text-xs">{f.key}</code> off in prod immediately, no approval. Audited.</p>
              <ActionForm action={killSwitch} hidden={{ flagId: f.id }} reasonLabel="Incident / reason (audited)" submits={[{ label: "Kill in prod", tone: "danger" }]} />
            </>
          )}
        </Card>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Environments</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {ENVS.map((env) => {
          const s = f.states[env];
          return (
            <Card key={env} title={ENV_LABEL[env]}>
              <div className="mb-3 flex items-center justify-between">
                <Badge tone={stateTone(env, s)}>{stateLabel(s)}</Badge>
                <span className="text-xs text-slate-500">{s.updatedBy ?? "—"} · {fmtTime(s.updatedAt)}</span>
              </div>
              {canEdit ? (
                <>
                  <ActionForm
                    action={setFlagState}
                    hidden={{ flagId: f.id, env, fromEnabled: s.enabled ? "on" : "off", fromRollout: s.rollout }}
                    fields={[
                      { name: "enabled", label: "Enabled", type: "select", defaultValue: s.enabled ? "on" : "off", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }] },
                      { name: "rollout", label: "Rollout % (0-100; off forces 0)", type: "number", defaultValue: String(s.rollout) },
                    ]}
                    submits={[{ label: env === "prod" ? "Request prod change" : "Apply" }]}
                  />
                  {env === "prod" && <p className="mt-2 text-xs text-amber-700">Prod changes need a second person with flags:approve_prod (Engineering Lead).</p>}
                </>
              ) : (
                <p className="text-sm text-slate-500">Read-only: you don&apos;t have flags:edit.</p>
              )}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Approvals</h2>
      <Card>{approvalsForTarget(target).length ? <ApprovalStatus target={target} /> : <p className="text-sm text-slate-500">No approval requests for this flag.</p>}</Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
      <AuditTrail target={target} />
    </>
  );
}
