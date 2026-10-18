"use client";

import { useActionState } from "react";
import type { ActionState } from "../action";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "date";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
};

export type Submit = { label: string; name?: string; value?: string; tone?: "primary" | "danger" | "neutral" };

const BTN = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  neutral: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50",
};
const INPUT = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

/**
 * Standard form for any platform action. Always collects a reason (unless reason=false) because
 * the reason is written to the audit log. Pass several `submits` to offer e.g. Approve / Reject.
 */
export function ActionForm({ action, hidden = {}, fields = [], submits = [{ label: "Submit" }], reason = true, reasonLabel = "Reason (audited)", compact = false }: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  hidden?: Record<string, string | number>;
  fields?: Field[];
  submits?: Submit[];
  reason?: boolean;
  reasonLabel?: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={compact ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {fields.map((f) => (
        <label key={f.name} className="block text-sm">
          <span className="mb-1 block text-slate-600">{f.label}</span>
          {f.type === "select" ? (
            <select name={f.name} defaultValue={f.defaultValue} required={f.required ?? true} className={INPUT}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === "textarea" ? (
            <textarea name={f.name} defaultValue={f.defaultValue} placeholder={f.placeholder} required={f.required ?? true} rows={3} className={INPUT} />
          ) : (
            <input name={f.name} type={f.type ?? "text"} step={f.type === "number" ? "any" : undefined} defaultValue={f.defaultValue}
              placeholder={f.placeholder} required={f.required ?? true} className={INPUT} />
          )}
        </label>
      ))}
      {reason && (
        <label className="block flex-1 text-sm">
          <span className="mb-1 block text-slate-600">{reasonLabel}</span>
          <input name="reason" required placeholder="Why are you doing this?" className={INPUT} />
        </label>
      )}
      <div className="flex gap-2">
        {submits.map((s) => (
          <button key={s.label} type="submit" name={s.name} value={s.value} disabled={pending}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${BTN[s.tone ?? "primary"]}`}>
            {pending ? "Working..." : s.label}
          </button>
        ))}
      </div>
      {state && <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
