import type { JobSummary } from "./job";

/**
 * When each action is open, as `contracts/contracts/square_job` decides it.
 * Pure functions over a job's fields and the acting address, so a button and
 * a test agree without a chain, and a button that is shown is a call that
 * simulates.
 */

type Job = Pick<JobSummary, "status" | "client" | "provider" | "budget" | "expiredAt" | "finalizeAfter">;

/** A strkey has one spelling, so equality is the comparison. */
function is(address: string | null, party: string): boolean {
  return address !== null && address === party;
}

/** `set_budget`: Open, and the caller is one of the two parties. */
export function budgetAvailable(job: Job, address: string | null): boolean {
  return job.status === "Open" && (is(address, job.client) || is(address, job.provider));
}

/** `fund`: Open, the client, a budget agreed, and the expiry still ahead. */
export function fundAvailable(job: Job, address: string | null, now: number): boolean {
  return job.status === "Open" && is(address, job.client) && job.budget > 0n && now < job.expiredAt;
}

/** `submit`: Funded, the provider, and the expiry still ahead. */
export function submitAvailable(job: Job, address: string | null, now: number): boolean {
  return job.status === "Funded" && is(address, job.provider) && now < job.expiredAt;
}

/** The challenge window has run out, so `finalize` is open and `reject` is not. */
export function windowClosed(job: Pick<JobSummary, "finalizeAfter">, now: number): boolean {
  return job.finalizeAfter > 0 && now >= job.finalizeAfter;
}

/** `finalize`: Submitted and the window closed. Anyone may; the signer only pays the fee. */
export function finalizeAvailable(job: Job, now: number): boolean {
  return job.status === "Submitted" && windowClosed(job, now);
}

/**
 * `reject`: the client, while Open or Funded at any time, and while Submitted
 * only inside the challenge window.
 */
export function rejectAvailable(job: Job, address: string | null, now: number): boolean {
  if (!is(address, job.client)) return false;
  if (job.status === "Open" || job.status === "Funded") return true;
  return job.status === "Submitted" && !windowClosed(job, now);
}

/** `claim_refund`: Funded and expired without a submission. Anyone may. */
export function refundAvailable(job: Job, now: number): boolean {
  return job.status === "Funded" && now >= job.expiredAt;
}

export interface ExpiryFloor {
  at: number;
  window: number;
  margin: number;
}

/**
 * The earliest expiry a new job should carry: one challenge window for the
 * settlement plus as much again of margin, because `submit` must land before
 * the expiry and the window then runs past it. The kernel only refuses an
 * expiry already in the past; this floor is what makes a job finishable.
 */
export function minimumExpiry(now: number, challengeWindow: number): ExpiryFloor {
  const margin = challengeWindow;
  return { at: now + challengeWindow + margin, window: challengeWindow, margin };
}
