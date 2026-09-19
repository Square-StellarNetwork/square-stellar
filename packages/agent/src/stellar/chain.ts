import { JobStatus, kernelEvent, type SquareClient, type SquareJob } from "@squaresdk/core/stellar";

/**
 * What the provider loop asks of the chain, in the loop's own terms, so the
 * loop is tested against a fake and runs against `SquareClient`. One
 * implementation each: `chainOf(client)` here, the test's in-memory kernel.
 */
export interface ProviderChain {
  /** The provider: the address whose jobs are taken and whose signature submits. */
  readonly account: string;
  /**
   * The jobs created for this provider, read forward: from `startLedger` the
   * first time, then from the `cursor` the previous read answered. Also the
   * ledger's clock, which every window is measured against.
   */
  createdJobs(from: { cursor: string } | { startLedger: number }): Promise<{ jobIds: bigint[]; cursor: string; now: bigint; latestLedger: number }>;
  latestLedger(): Promise<number>;
  getJob(jobId: bigint): Promise<SquareJob>;
  /** Puts the deliverable's hash on chain; answers the hash (hex) and the transaction. */
  submit(jobId: bigint, content: string): Promise<{ deliverable: string; hash: string }>;
  finalize(jobId: bigint): Promise<{ hash: string }>;
  withdrawable(): Promise<bigint>;
  withdraw(amount: bigint): Promise<{ hash: string }>;
}

/** The chain as `@squaresdk/core/stellar`'s client sees it. */
export function chainOf(client: SquareClient): ProviderChain {
  const account = client.account;
  return {
    account,
    async createdJobs(from) {
      const page = await client.getEvents({
        topics: [[{ symbol: "job_created" }, "*", "*", { address: account }]],
        ...(from && "cursor" in from ? { cursor: from.cursor } : { startLedger: from.startLedger }),
      });
      const jobIds: bigint[] = [];
      for (const event of page.events) {
        if (event.contract !== "square_job" || event.name !== "job_created") continue;
        const created = kernelEvent([event], "job_created");
        if (created && created.provider === account) jobIds.push(created.jobId);
      }
      return { jobIds, cursor: page.cursor, now: page.latestLedgerCloseTime, latestLedger: page.latestLedger };
    },
    latestLedger: () => client.latestLedger(),
    getJob: (jobId) => client.getJob(jobId),
    async submit(jobId, content) {
      const result = await client.submit(jobId, content);
      const submitted = kernelEvent(result.events, "submitted");
      if (!submitted || submitted.jobId !== jobId) throw new Error(`submit for job ${jobId} landed in ${result.hash} without its submitted event`);
      return { deliverable: Buffer.from(submitted.deliverable).toString("hex"), hash: result.hash };
    },
    async finalize(jobId) {
      const result = await client.finalize(jobId);
      return { hash: result.hash };
    },
    withdrawable: () => client.withdrawable(),
    async withdraw(amount) {
      const result = await client.withdraw(amount);
      return { hash: result.hash };
    },
  };
}

export { JobStatus };
