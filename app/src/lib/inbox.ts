import { budgetAvailable, fundAvailable, refundAvailable, rejectAvailable, submitAvailable, windowClosed } from "./actions";
import type { JobSummary } from "./job";

export type InboxKind = "submit" | "fund" | "budget" | "reject" | "finalize" | "refund";

export interface InboxGroup {
  kind: InboxKind;
  title: string;
  body: string;
  jobs: JobSummary[];
}

const COPY: Record<InboxKind, { title: string; body: string }> = {
  submit: {
    title: "Waiting for your deliverable",
    body: "You are the provider and the escrow is funded. Submit the hash of your work before the job expires; the challenge window starts when you do.",
  },
  fund: {
    title: "Waiting for your funding",
    body: "The budget is agreed. Fund it to start the job; the transfer is authorized in the same signature, so there is no approval step.",
  },
  budget: { title: "Needs a budget", body: "These jobs have no budget yet. Either party may set one, and funding is what accepts it." },
  reject: {
    title: "Your challenge window is open",
    body: "The provider submitted. Until the window closes you may reject and take the whole budget back; after it, anyone may finalize.",
  },
  finalize: {
    title: "Ready to finalize",
    body: "The challenge window closed and nobody rejected. Anyone may finalize; the provider is credited the budget less the platform fee.",
  },
  refund: { title: "Expired, refund available", body: "The job expired without a submission. Anyone may claim the refund; the budget goes back to the client." },
};

const ORDER: InboxKind[] = ["submit", "fund", "budget", "reject", "finalize", "refund"];

/**
 * What this wallet is being waited on for, on one job. The kernel settles by
 * window and has no evaluator, so every kind here is a call the connected
 * wallet can actually make.
 */
export function classify(job: JobSummary, address: string, now: number): InboxKind | null {
  if (submitAvailable(job, address, now)) return "submit";
  if (refundAvailable(job, now) && job.client === address) return "refund";
  if (fundAvailable(job, address, now)) return "fund";
  if (budgetAvailable(job, address) && job.budget === 0n) return "budget";
  if (job.status === "Submitted") {
    if (windowClosed(job, now)) return job.client === address || job.provider === address ? "finalize" : null;
    return rejectAvailable(job, address, now) ? "reject" : null;
  }
  return null;
}

export function walletInbox(jobs: readonly JobSummary[], address: string | undefined, now: number): InboxGroup[] {
  if (!address) return [];
  const buckets = new Map<InboxKind, JobSummary[]>();
  for (const job of jobs) {
    const kind = classify(job, address, now);
    if (!kind) continue;
    const list = buckets.get(kind) ?? [];
    list.push(job);
    buckets.set(kind, list);
  }
  return ORDER.filter((kind) => buckets.has(kind)).map((kind) => ({ kind, ...COPY[kind], jobs: buckets.get(kind) ?? [] }));
}

export function walletJobCount(jobs: readonly JobSummary[], address: string | undefined): number {
  if (!address) return 0;
  return jobs.filter((job) => job.client === address || job.provider === address).length;
}
