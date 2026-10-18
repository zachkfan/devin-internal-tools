import type { Tone } from "@/platform/ui/primitives";
import type { DisputeStatus, ReasonCategory } from "./queries";

export const STATUS_TONE: Record<DisputeStatus, Tone> = { open: "blue", accepted: "gray", contested: "purple" };
export const REASON_TONE: Record<ReasonCategory, Tone> = {
  fraud: "red", product_not_received: "yellow", duplicate: "blue", not_as_described: "yellow", credit_not_processed: "gray", subscription_canceled: "gray",
};

export const daysLeftLabel = (days: number) => (days < 0 ? `Overdue ${-days}d` : days === 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"}`);
