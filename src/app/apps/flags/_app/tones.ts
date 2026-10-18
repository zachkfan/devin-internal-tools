import type { Tone } from "@/platform/ui/primitives";
import type { Env, EnvState } from "./queries";

export const ENV_LABEL: Record<Env, string> = { dev: "Dev", staging: "Staging", prod: "Prod" };

/** On in prod is the state people need to notice, so it gets the loudest tone. */
export const stateTone = (env: Env, s: EnvState): Tone => (!s.enabled ? "gray" : env === "prod" ? (s.rollout === 100 ? "red" : "yellow") : "green");
export const stateLabel = (s: EnvState) => (s.enabled ? `on · ${s.rollout}%` : "off");
