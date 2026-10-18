import type { Tone } from "@/platform/ui/primitives";
import type { KycStatus, Risk } from "./queries";

export const RISK_TONE: Record<Risk, Tone> = { low: "green", medium: "yellow", high: "red" };
export const STATUS_TONE: Record<KycStatus, Tone> = { pending: "gray", in_review: "blue", escalated: "purple", approved: "green", rejected: "red" };
