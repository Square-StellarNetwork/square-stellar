import { createHash } from "node:crypto";
import { JobStatus, type SquareJob } from "@squaresdk/core/stellar";
import type { ProviderChain } from "../src/stellar/index.js";

/**
 * The kernel's rules in memory, as much of them as the provider loop leans
 * on: statuses, the window, who may submit, finalize's timing, credits and
 * withdrawal. The test drives the client's side (`create`, `fund`, `reject`)
 * and the clock; the loop drives the provider's through `ProviderChain`.
 */
export class FakeKernel {
  now = 1_789_776_000n;
  ledger = 1_000;
  readonly window: bigint;
  private counter = 0n;
  readonly jobs = new Map<bigint, SquareJob>();
  readonly credits = new Map<string, bigint>();
  readonly calls: string[] = [];
  /** Injected failures: a step name to throw on, once. */
  failNext = new Set<string>();
  readonly created: Array<{ jobId: bigint; provider: string; ledger: number }> = [];

  constructor(window = 600n) {
    this.window = window;
  }

  create(client: string, provider: string, description: string, expiresIn = 86_400n): bigint {
    // Every creation closes in a new ledger, as it would on the network.
    this.ledger += 1;
    const jobId = ++this.counter;
    this.jobs.set(jobId, {
      id: jobId,
      client,
      provider,
      status: JobStatus.Open,
      budget: 0n,
      platformFeeBps: 250,
      challengeWindow: this.window,
      createdAt: this.now,
      expiredAt: this.now + expiresIn,
      fundedAt: 0n,
      submittedAt: 0n,
      deliverable: undefined,
      description,
      finalizeAfter: undefined,
    });
    this.created.push({ jobId, provider, ledger: this.ledger });
    return jobId;
  }

  fund(jobId: bigint, budget: bigint): void {
    const job = this.get(jobId);
    if (job.status !== JobStatus.Open) throw new Error("WrongStatus");
    job.budget = budget;
    job.status = JobStatus.Funded;
    job.fundedAt = this.now;
  }

  reject(jobId: bigint): void {
    const job = this.get(jobId);
    if (job.status === JobStatus.Submitted && this.now >= job.finalizeAfter!) throw new Error("WindowClosed");
    if (job.status === JobStatus.Funded || job.status === JobStatus.Submitted) this.credit(job.client, job.budget);
    job.status = JobStatus.Rejected;
  }

  expire(jobId: bigint): void {
    const job = this.get(jobId);
    if (job.status !== JobStatus.Funded) throw new Error("WrongStatus");
    this.credit(job.client, job.budget);
    job.status = JobStatus.Expired;
  }

  advance(seconds: bigint): void {
    this.now += seconds;
    this.ledger += Number(seconds / 5n);
  }

  get(jobId: bigint): SquareJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("InvalidJob");
    return job;
  }

  private credit(account: string, amount: bigint): void {
    this.credits.set(account, (this.credits.get(account) ?? 0n) + amount);
  }

  private fail(step: string): void {
    if (this.failNext.delete(step)) throw new Error(`${step} failed (injected)`);
  }

  /** The provider's view. */
  chainFor(account: string): ProviderChain {
    const kernel = this;
    return {
      account,
      async createdJobs(from) {
        kernel.calls.push("createdJobs");
        kernel.fail("createdJobs");
        const since = "cursor" in from ? Number(from.cursor) : from.startLedger;
        const mine = kernel.created.filter((c) => c.provider === account && c.ledger >= since);
        return { jobIds: mine.map((c) => c.jobId), cursor: String(kernel.ledger + 1), now: kernel.now, latestLedger: kernel.ledger };
      },
      async latestLedger() {
        return kernel.ledger;
      },
      async getJob(jobId) {
        kernel.calls.push(`getJob ${jobId}`);
        return structuredClone(kernel.get(jobId));
      },
      async submit(jobId, content) {
        kernel.calls.push(`submit ${jobId}`);
        kernel.fail("submit");
        const job = kernel.get(jobId);
        if (job.status !== JobStatus.Funded) throw new Error("WrongStatus");
        if (job.provider !== account) throw new Error("NotProvider");
        if (kernel.now >= job.expiredAt) throw new Error("Expired");
        const deliverable = createHash("sha256").update(content, "utf8").digest();
        job.status = JobStatus.Submitted;
        job.submittedAt = kernel.now;
        job.deliverable = new Uint8Array(deliverable);
        job.finalizeAfter = kernel.now + kernel.window;
        return { deliverable: deliverable.toString("hex"), hash: `submit-${jobId}` };
      },
      async finalize(jobId) {
        kernel.calls.push(`finalize ${jobId}`);
        const job = kernel.get(jobId);
        if (job.status !== JobStatus.Submitted) throw new Error("WrongStatus");
        if (kernel.now < job.finalizeAfter!) throw new Error("WindowOpen");
        const fee = (job.budget * 250n) / 10_000n;
        kernel.credit(job.provider, job.budget - fee);
        job.status = JobStatus.Completed;
        return { hash: `finalize-${jobId}` };
      },
      async withdrawable() {
        return kernel.credits.get(account) ?? 0n;
      },
      async withdraw(amount) {
        kernel.calls.push(`withdraw ${amount}`);
        kernel.fail("withdraw");
        const balance = kernel.credits.get(account) ?? 0n;
        if (amount > balance) throw new Error("InsufficientBalance");
        kernel.credits.set(account, balance - amount);
        return { hash: `withdraw-${amount}` };
      },
    };
  }
}
