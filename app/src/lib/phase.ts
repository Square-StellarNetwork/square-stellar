import { refundAvailable, windowClosed } from "./actions";
import type { JobSummary } from "./job";

export type JobPhase = "open" | "needs-budget" | "funded" | "refundable" | "in-window" | "finalizable" | "completed" | "rejected" | "expired";

type Phased = Pick<JobSummary, "status" | "client" | "provider" | "budget" | "expiredAt" | "finalizeAfter">;

/**
 * Where a job stands, which is its status plus the two clocks the kernel
 * reads: the expiry a Funded job can be refunded after, and the challenge
 * window a Submitted job is finalized after.
 */
export function jobPhase(job: Phased, now: number): JobPhase {
  switch (job.status) {
    case "Open":
      return job.budget === 0n ? "needs-budget" : "open";
    case "Funded":
      return refundAvailable(job, now) ? "refundable" : "funded";
    case "Submitted":
      return windowClosed(job, now) ? "finalizable" : "in-window";
    case "Completed":
      return "completed";
    case "Rejected":
      return "rejected";
    case "Expired":
      return "expired";
  }
}

export const PHASE_LABELS: Record<JobPhase, string> = {
  open: "Open",
  "needs-budget": "Needs a budget",
  funded: "Funded",
  refundable: "Refundable",
  "in-window": "In window",
  finalizable: "Finalizable",
  completed: "Completed",
  rejected: "Rejected",
  expired: "Expired",
};
