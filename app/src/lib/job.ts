import { JOB_STATUS_NAMES, type SquareJob } from "@squaresdk/core/stellar";

/**
 * The kernel's job as the pages hold it: the SDK's record with the status
 * named, the ledger seconds as numbers, and the settlement moment as zero
 * rather than undefined while nothing has been submitted. Everything else on
 * the record is the contract's own field, unchanged.
 *
 * The SDK's own type comes from the generated bindings, so a field the
 * contract does not have cannot be read here.
 */
export interface JobSummary {
  id: bigint;
  client: string;
  provider: string;
  status: JobStatusName;
  /** Base units of the kernel's payment token; zero until `set_budget`. */
  budget: bigint;
  platformFeeBps: number;
  /** Seconds the client has to reject after a submission. */
  challengeWindow: number;
  createdAt: number;
  expiredAt: number;
  /** Zero until funded. */
  fundedAt: number;
  /** Zero until submitted. */
  submittedAt: number;
  /** The 32-byte hash the provider submitted; null until then. */
  deliverable: Uint8Array | null;
  description: string;
  /** `submittedAt + challengeWindow`: when finalize opens and reject closes. Zero until submitted. */
  finalizeAfter: number;
}

export type JobStatusName = (typeof JOB_STATUS_NAMES)[keyof typeof JOB_STATUS_NAMES];

export function toSummary(job: SquareJob): JobSummary {
  return {
    id: job.id,
    client: job.client,
    provider: job.provider,
    status: JOB_STATUS_NAMES[job.status],
    budget: job.budget,
    platformFeeBps: job.platformFeeBps,
    challengeWindow: Number(job.challengeWindow),
    createdAt: Number(job.createdAt),
    expiredAt: Number(job.expiredAt),
    fundedAt: Number(job.fundedAt),
    submittedAt: Number(job.submittedAt),
    deliverable: job.deliverable ?? null,
    description: job.description,
    finalizeAfter: job.finalizeAfter === undefined ? 0 : Number(job.finalizeAfter),
  };
}

/** The kernel's fee arithmetic: integer basis points off the budget, truncated, as `fee_of` does. */
export function platformFee(job: Pick<JobSummary, "budget" | "platformFeeBps">): bigint {
  return (job.budget * BigInt(job.platformFeeBps)) / 10_000n;
}

/** What `finalize` credits the provider: the budget less the fee. */
export function payout(job: Pick<JobSummary, "budget" | "platformFeeBps">): bigint {
  return job.budget - platformFee(job);
}
