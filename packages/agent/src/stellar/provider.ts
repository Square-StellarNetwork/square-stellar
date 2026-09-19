/**
 * The hired agent's side of a job, on Stellar (#29, D7 — the MVP).
 *
 * An agent that a client has opened and funded a job for watches the kernel's
 * events for jobs where it is the provider, runs the capability it was hired
 * for, submits the deliverable's hash, and takes its payout home once the
 * challenge window has closed and someone has finalized.
 *
 * Four of those five steps are the chain's and one is the agent's, and that
 * is the whole loop:
 *
 *   funded → handle → submit → (the window, someone finalizes) → withdraw
 *
 * Identity (8004 registration and `did:aip`), x402 paid routes, delegation
 * and the A2A task protocol are phase 2 (#26, #28, #34): this needs none of
 * them, only `@squaresdk/core/stellar` and a key.
 */
import {
  JobStatus,
  kernelEvents,
  sameAddress,
  type LocatedKernelEvent,
  type SquareClient,
  type SquareJob,
  type TransactionResult,
} from "@squaresdk/core/stellar";

/**
 * What the agent does when it is hired. Whatever it returns is hashed and
 * that hash is what `submit` puts on chain, so the deliverable itself stays
 * wherever the agent and its client agreed it would.
 */
export type JobHandler = (job: SquareJob) => Promise<string | Uint8Array> | string | Uint8Array;

export interface ProviderAgentOptions {
  /** A client whose signer is the provider: `submit` and `withdraw` are signed by it. */
  client: SquareClient;
  handle: JobHandler;
  /**
   * Where to start reading events. The deployment's `deployLedger` by
   * default, and the latest ledger when the record names none; a restart
   * that has kept its cursor passes that instead.
   */
  fromLedger?: number | undefined;
  /** An event id from a previous run, which takes precedence over `fromLedger`. */
  cursor?: string | undefined;
  /** How long `run` waits between passes. A ledger closes about every five seconds. */
  pollIntervalMs?: number | undefined;
  /**
   * Unix seconds the job's expiry is measured against. The default is the
   * wall clock, which tracks the ledger's closely enough for a window
   * measured in minutes; the contract measures `expired_at` against
   * `env.ledger().timestamp()`, and a test passes its own.
   */
  now?: (() => bigint | Promise<bigint>) | undefined;
  log?: ((line: string) => void) | undefined;
}

/** What one pass did. Every field is empty on a quiet pass, which is most of them. */
export interface PassReport {
  /** Jobs delivered in this pass, with the transaction that submitted each. */
  delivered: { jobId: bigint; hash: string }[];
  /** The withdrawal, when there was a payout to take. */
  withdrawn?: { amount: bigint; hash: string } | undefined;
  /** Jobs seen and not delivered, and why. */
  skipped: { jobId: bigint; reason: string }[];
  /** Where to resume from; pass it back as `cursor` after a restart. */
  cursor: string | undefined;
  latestLedger: number;
}

export class ProviderAgent {
  readonly client: SquareClient;
  readonly address: string;
  private readonly handle: JobHandler;
  private readonly pollIntervalMs: number;
  private readonly now: () => bigint | Promise<bigint>;
  private readonly log: (line: string) => void;
  private cursor: string | undefined;
  private fromLedger: number | undefined;
  /** Jobs this process has already submitted for, so a slow ledger is not delivered twice. */
  private readonly submitted = new Set<bigint>();

  constructor(options: ProviderAgentOptions) {
    this.client = options.client;
    this.address = options.client.account;
    this.handle = options.handle;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.now = options.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    this.log = options.log ?? (() => {});
    this.cursor = options.cursor;
    this.fromLedger = options.fromLedger ?? options.client.deployment.deployLedger;
  }

  /**
   * One pass: read what the kernel emitted since the cursor, deliver every
   * funded job that is this agent's, and sweep whatever the kernel owes it.
   *
   * Safe to call again after a crash. A job already submitted is `WrongStatus`
   * to the contract and is skipped here before it gets that far, so nothing
   * depends on the cursor having been persisted.
   */
  async pass(): Promise<PassReport> {
    const report: PassReport = { delivered: [], skipped: [], cursor: this.cursor, latestLedger: 0 };
    const { events, latestLedger } = await this.readEvents();
    report.latestLedger = latestLedger;

    // `funded` carries the client and the amount but not the provider, so the
    // job record is what says whether this one is ours. One read per funded
    // job, and only for jobs funded since the last pass.
    const funded = events.filter((event) => event.name === "funded");
    for (const event of funded) {
      const jobId = event.jobId;
      if (this.submitted.has(jobId)) continue;
      const job = await this.client.getJob(jobId);
      const reason = await this.cannotDeliver(job);
      if (reason) {
        if (reason !== "not ours") report.skipped.push({ jobId, reason });
        continue;
      }
      const result = await this.deliver(job);
      report.delivered.push({ jobId, hash: result.hash });
    }

    const swept = await this.sweep();
    if (swept) report.withdrawn = swept;

    report.cursor = this.cursor;
    return report;
  }

  /** Passes until the signal aborts. Errors in a pass are logged and the loop continues. */
  async run(options: { signal?: AbortSignal } = {}): Promise<void> {
    const { signal } = options;
    this.log(`provider ${this.address} watching ${this.client.deployment.squareJob} on ${this.client.deployment.network}`);
    while (!signal?.aborted) {
      try {
        const report = await this.pass();
        for (const { jobId, hash } of report.delivered) this.log(`job ${jobId}: submitted, tx ${hash}`);
        for (const { jobId, reason } of report.skipped) this.log(`job ${jobId}: ${reason}`);
        if (report.withdrawn) this.log(`withdrew ${report.withdrawn.amount}, tx ${report.withdrawn.hash}`);
      } catch (error) {
        this.log(`pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.wait(signal);
    }
  }

  /** The reason this job is not one to deliver, or undefined when it is. */
  private async cannotDeliver(job: SquareJob): Promise<string | undefined> {
    if (!sameAddress(job.provider, this.address)) return "not ours";
    if (job.status !== JobStatus.Funded) return `status is ${job.status}, not Funded`;
    const now = await this.now();
    // `submit` refuses once the clock has passed `expired_at`. Saying so here
    // means the handler's work is not spent on a job that cannot be delivered.
    if (now >= job.expiredAt) return `expired at ${job.expiredAt}`;
    return undefined;
  }

  private async deliver(job: SquareJob): Promise<TransactionResult<void>> {
    const content = await this.handle(job);
    const result = await this.client.submit(job.id, content);
    this.submitted.add(job.id);
    return result;
  }

  /**
   * The kernel credits a payout to a ledger and pushes nothing, so the agent
   * takes it. Withdrawing everything owed is one transaction whatever the
   * number of jobs it came from.
   */
  private async sweep(): Promise<{ amount: bigint; hash: string } | undefined> {
    const owed = await this.client.withdrawable();
    if (owed <= 0n) return undefined;
    const result = await this.client.withdraw(owed);
    return { amount: owed, hash: result.hash };
  }

  private async readEvents(): Promise<{ events: LocatedKernelEvent[]; latestLedger: number }> {
    const filters = [{ type: "contract" as const, contractIds: [this.client.deployment.squareJob] }];
    const page = this.cursor
      ? await this.client.server.getEvents({ cursor: this.cursor, filters, limit: 100 })
      : await this.client.server.getEvents({ startLedger: await this.startLedger(), filters, limit: 100 });

    const raw = page.events ?? [];
    const last = raw[raw.length - 1];
    if (last) this.cursor = last.id;
    // An empty page still moves the agent forward: without a cursor the next
    // pass would ask for the same ledgers again, and on a quiet network that
    // start eventually falls out of the RPC's retention window.
    else this.fromLedger = page.latestLedger;

    return { events: kernelEvents(this.client.decodeEvents(page)), latestLedger: page.latestLedger };
  }

  private async startLedger(): Promise<number> {
    if (this.fromLedger !== undefined && this.fromLedger > 0) return this.fromLedger;
    const latest = await this.client.latestLedger();
    this.fromLedger = latest;
    return latest;
  }

  private wait(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.pollIntervalMs);
      function done(): void {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}

export function createProviderAgent(options: ProviderAgentOptions): ProviderAgent {
  return new ProviderAgent(options);
}
