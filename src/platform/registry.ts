import type { AppManifest } from "./app";
import { manifest as kyc } from "@/app/apps/kyc/_app/manifest";

// Register every internal app here (and its actions in ./action-index.ts).
// tests/guardrails.test.ts fails if an app folder exists under src/app/apps without being registered.
export const apps: AppManifest[] = [kyc];

export const getApp = (id: string) => apps.find((a) => a.id === id);
