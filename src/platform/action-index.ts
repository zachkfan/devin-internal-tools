import * as flags from "@/app/apps/flags/_app/actions";
import * as kyc from "@/app/apps/kyc/_app/actions";
import * as refunds from "@/app/apps/refunds/_app/actions";
import { isPlatformAction, type PlatformAction } from "./action";

// Every app's actions module, keyed by app id. Needed so approved requests can be executed later.
// tests/guardrails.test.ts fails if an app is missing here.
export const actionModules: Record<string, Record<string, unknown>> = { kyc, refunds, flags };

export function allActions(): PlatformAction[] {
  return Object.values(actionModules).flatMap((m) => Object.values(m).filter(isPlatformAction));
}

export const findAction = (app: string, name: string) =>
  allActions().find((a) => a.def.app === app && a.def.name === name);
