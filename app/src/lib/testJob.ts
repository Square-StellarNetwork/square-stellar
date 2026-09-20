import { Keypair } from "@stellar/stellar-sdk";

import type { JobSummary } from "./job";

/**
 * A job record for the tests. Real strkeys, because a strkey's checksum makes
 * an invented address a lie, and seven-decimal amounts, because that is what
 * a Stellar Asset Contract has.
 */
export const CLIENT = Keypair.random().publicKey();
export const PROVIDER = Keypair.random().publicKey();
export const STRANGER = Keypair.random().publicKey();

/** One whole token in base units. */
export const ONE = 10_000_000n;

export function job(over: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 1n,
    client: CLIENT,
    provider: PROVIDER,
    status: "Open",
    budget: ONE,
    platformFeeBps: 250,
    challengeWindow: 30,
    createdAt: 1_000,
    expiredAt: 10_000,
    fundedAt: 0,
    submittedAt: 0,
    deliverable: null,
    description: "A job the tests build",
    finalizeAfter: 0,
    ...over,
  };
}

/** A funded job: what `fund` leaves behind. */
export function funded(over: Partial<JobSummary> = {}): JobSummary {
  return job({ status: "Funded", fundedAt: 1_100, ...over });
}

/** A submitted job, with the window the kernel computes from it. */
export function submitted(at = 1_200, over: Partial<JobSummary> = {}): JobSummary {
  const base = funded({ status: "Submitted", submittedAt: at, deliverable: new Uint8Array(32).fill(7), ...over });
  return { ...base, finalizeAfter: base.finalizeAfter || at + base.challengeWindow };
}
