import type { Tone } from "@/platform/ui/primitives";
import type { RefundState } from "./queries";

export const REFUND_STATE_TONE: Record<RefundState, Tone> = { none: "gray", partial: "yellow", full: "purple" };
export const REFUND_STATE_LABEL: Record<RefundState, string> = { none: "not refunded", partial: "partially refunded", full: "fully refunded" };
