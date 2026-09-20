import type { JobStatusName } from "./contracts";

/**
 * When each action is open, as the contracts decide it. Pure functions over a
 * job's fields, so a button and a test agree without a chain.
 */

export interface EvaluatedJob {
  evaluator: string;
}

export interface RefundableJob extends EvaluatedJob {
  status: JobStatusName;
  expiredAt: number;
}

export interface SubmittableJob {
  status: JobStatusName;
  expiredAt: number;
  settlementHorizon: number;
}

export interface DisputableJob extends EvaluatedJob {
  status: JobStatusName;
  challengeEnd: number;
}

export interface ExpiryFloor {
  at: number;
  horizon: number;
  margin: number;
}

/** A strkey has one spelling, so equality is the comparison. */
export function keeperEvaluates(job: EvaluatedJob, keeperEvaluator: string): boolean {
  return job.evaluator === keeperEvaluator;
}

export function refundAvailable(job: RefundableJob, keeperEvaluator: string, now: number): boolean {
  if (now < job.expiredAt) return false;
  if (job.status === "Funded") return true;
  return job.status === "Submitted" && !keeperEvaluates(job, keeperEvaluator);
}

export function submitDeadline(job: { expiredAt: number; settlementHorizon: number }): number {
  return job.expiredAt - job.settlementHorizon;
}

export function submitAvailable(job: SubmittableJob, now: number): boolean {
  return job.status === "Funded" && now < job.expiredAt && now <= submitDeadline(job);
}

export function challengeWindowClosed(challengeEnd: number, now: number): boolean {
  return challengeEnd > 0 && now >= challengeEnd;
}

export function disputeAvailable(job: DisputableJob, keeperEvaluator: string, now: number): boolean {
  return job.status === "Submitted" && keeperEvaluates(job, keeperEvaluator) && !challengeWindowClosed(job.challengeEnd, now);
}

/** Finalize opens when the challenge window has closed and nobody disputed. */
export function finalizeAvailable(job: DisputableJob & { disputed: boolean }, keeperEvaluator: string, now: number): boolean {
  return job.status === "Submitted" && keeperEvaluates(job, keeperEvaluator) && !job.disputed && challengeWindowClosed(job.challengeEnd, now);
}

export function minimumExpiry(now: number, settlementHorizon: number): ExpiryFloor {
  const margin = settlementHorizon;
  return { at: now + settlementHorizon + margin, horizon: settlementHorizon, margin };
}
