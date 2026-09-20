import type { JobStatusName } from "./contracts";

export type JobPhase =
  | "open"
  | "funded"
  | "submitted"
  | "in-window"
  | "finalizable"
  | "disputed"
  | "completed"
  | "rejected"
  | "expired";

export function jobPhase(job: { status: JobStatusName; challengeEnd: number; disputed: boolean }, now: number): JobPhase {
  switch (job.status) {
    case "Open":
      return "open";
    case "Funded":
      return "funded";
    case "Submitted":
      if (job.disputed) return "disputed";
      if (job.challengeEnd > 0 && now >= job.challengeEnd) return "finalizable";
      return job.challengeEnd > 0 ? "in-window" : "submitted";
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
  funded: "Funded",
  submitted: "Submitted",
  "in-window": "In window",
  finalizable: "Finalizable",
  disputed: "Disputed",
  completed: "Completed",
  rejected: "Rejected",
  expired: "Expired",
};

/** The claim market is Phase 2 (#39's MVP scope); its labels stay for when it lands. */
export const LISTING_LABELS: Record<string, string> = { None: "Not listed", Listed: "Listed", Sold: "Sold", Cancelled: "Cancelled" };
