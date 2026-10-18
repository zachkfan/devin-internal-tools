"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "../action";

/** Shows a masked value; revealing it calls an audited platform action and requires a reason. */
export function RevealField({ masked, action, hidden, canReveal }: {
  masked: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  hidden: Record<string, string | number>;
  canReveal: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const revealed = state?.ok ? (state.data as { value?: string } | undefined)?.value : undefined;

  if (revealed) return <span className="font-mono text-amber-800">{revealed} <span className="text-xs text-slate-400">(reveal logged)</span></span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono">{masked}</span>
      {canReveal && !open && (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-700 hover:underline">Reveal</button>
      )}
      {open && (
        <form action={formAction} className="inline-flex items-center gap-1">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <input name="reason" required placeholder="Reason (audited)" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
          <button disabled={pending} className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white disabled:opacity-50">Reveal</button>
        </form>
      )}
      {state && !state.ok && <span className="text-xs text-red-700">{state.message}</span>}
    </span>
  );
}
