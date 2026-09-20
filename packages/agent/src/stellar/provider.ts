import { JobStatus, JOB_STATUS_NAMES } from "@squaresdk/core/stellar";
import type { ProviderChain } from "./chain.js";

/** What a capability gets for a job: the job's description is the input. */
export interface JobCall {
  jobId: bigint;
  capability: string;
  input: string;
  client: string;
  budget: bigint;
  signal: AbortSignal;
}

export type JobHandler = (call: JobCall) => Promise<string>;

/** One job the provider has seen, as the loop keeps it, JSON-safe. */
export interface TrackedJob {
  jobId: string;
  /** The kernel's status name at the last read. */
  status: string;
  capability?: string | undefined;
  /** The handler's output, kept until it is on chain and then for the client to fetch. */
  content?: string | undefined;
  /** The 32-byte hash on chain, hex. */
  deliverable?: string | undefined;
  submittedIn?: string | undefined;
  finalizedIn?: string | undefined;
  withdrawnIn?: string | undefined;
  /** Runs of the handler so far, successful or not. */
  attempts: number;
  /** The last thing that went wrong, until something goes right. */
  error?: string | undefined;
  /** Nothing more to do: settled, closed by the client, expired, or given up on. */
  done: boolean;
  updatedAt: number;
}

export interface ProviderState {
  cursor?: string | undefined;
  jobs: Record<string, TrackedJob>;
}

/** Where the state lives between ticks and across restarts. */
export interface ProviderStore {
  load(): Promise<ProviderState | undefined>;
  save(state: ProviderState): Promise<void>;
}

export type ProviderEvent =
  | { type: "discovered"; jobId: bigint }
  | { type: "working"; jobId: bigint; capability: string; attempt: number }
  | { type: "unserviceable"; jobId: bigint; reason: string }
  | { type: "submitted"; jobId: bigint; deliverable: string; hash: string }
  | { type: "finalized"; jobId: bigint; hash: string }
  | { type: "withdrawn"; amount: bigint; hash: string }
  | { type: "closed"; jobId: bigint; status: string }
  | { type: "error"; jobId: bigint | undefined; step: string; error: unknown };

export interface ProviderOptions {
  chain: ProviderChain;
  /** The work, by capability id. */
  handlers: Record<string, JobHandler>;
  /**
   * The capability a job whose description names none is served with. With
   * one handler, that one; with several and no default, such a job is left
   * alone, with an `unserviceable` event.
   */
  defaultCapability?: string | undefined;
  /**
   * The least a job may be funded with for a capability, in base units, or
   * undefined when any funded amount will do. A job funded below it is left
   * alone (`unserviceable`) before the handler runs: the kernel enforces no
   * price, so this is where the agent's price is.
   */
  minimumBudgetFor?: ((capability: string) => bigint | undefined) | undefined;
  /** Where to start reading job creations the first time; the latest ledger when omitted (only jobs from now on). */
  startLedger?: number | undefined;
  store?: ProviderStore | undefined;
  /** How often the handler is retried on a job that is still Funded. Default 3. */
  maxAttempts?: number | undefined;
  /** How long one run of the handler may take, ms. Default 120000. */
  handlerTimeoutMs?: number | undefined;
  onEvent?: ((event: ProviderEvent) => void) | undefined;
}

export interface Provider {
  readonly state: ProviderState;
  /** One pass: discover, work, submit, finalize, withdraw. Serialized: a tick while one runs waits for it. */
  tick(): Promise<void>;
  /** `tick` every `intervalMs` until `stop`. */
  start(intervalMs: number): void;
  stop(): Promise<void>;
  jobs(): TrackedJob[];
  job(jobId: bigint): TrackedJob | undefined;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_HANDLER_TIMEOUT_MS = 120_000;

/** `<capability>: <input>` names the capability; anything else is the whole input for the default. */
const NAMED = /^([a-z0-9][a-z0-9._-]*):\s*/i;

export function memoryStore(): ProviderStore {
  let kept: ProviderState | undefined;
  return {
    load: async () => (kept ? structuredClone(kept) : undefined),
    save: async (state) => {
      kept = structuredClone(state);
    },
  };
}

/**
 * The provider's side of the kernel, autonomous: the loop that finds the
 * jobs created for this account, works each once it is Funded, submits the
 * output's hash, finalizes once the challenge window has passed (anyone
 * may, and the payee has the interest), and withdraws what was credited.
 * The job's `description` is the work order: `translate: …` picks the
 * `translate` capability, a bare description goes to the default.
 *
 * Everything it knows is in `state`, kept by the store, so a restart resumes:
 * a handler's output that never reached the chain is submitted on the next
 * tick rather than computed again, and a handler that failed is retried up
 * to `maxAttempts` while the job is still Funded. A job funded below the
 * capability's price (`minimumBudgetFor`) is left alone. What the client does
 * (`reject`) and what time does (`expired`) are read off the chain each tick,
 * never assumed.
 */
export function createProvider(options: ProviderOptions): Provider {
  const { chain, handlers } = options;
  const store = options.store ?? memoryStore();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  const emit = options.onEvent ?? (() => {});
  const state: ProviderState = { jobs: {} };
  let loaded = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const defaultCapability = (): string | undefined => {
    if (options.defaultCapability !== undefined) return options.defaultCapability;
    const ids = Object.keys(handlers);
    return ids.length === 1 ? ids[0] : undefined;
  };

  function capabilityFor(description: string): { capability: string; input: string } | { reason: string } {
    const named = NAMED.exec(description);
    if (named) {
      const id = named[1]!;
      if (Object.hasOwn(handlers, id)) return { capability: id, input: description.slice(named[0].length) };
    }
    const fallback = defaultCapability();
    if (fallback === undefined) {
      return { reason: `the description names no capability of this agent (${Object.keys(handlers).join(", ") || "none declared"}) and there is no default` };
    }
    return { capability: fallback, input: description };
  }

  async function load(): Promise<void> {
    if (loaded) return;
    const kept = await store.load();
    if (kept) {
      state.cursor = kept.cursor;
      state.jobs = kept.jobs;
    }
    loaded = true;
  }

  const save = () => store.save(state);

  function touch(job: TrackedJob, patch: Partial<TrackedJob>): void {
    Object.assign(job, patch, { updatedAt: Date.now() });
  }

  async function discover(): Promise<bigint> {
    const from = state.cursor !== undefined ? { cursor: state.cursor } : { startLedger: options.startLedger ?? (await chain.latestLedger()) };
    const page = await chain.createdJobs(from);
    state.cursor = page.cursor;
    for (const jobId of page.jobIds) {
      const key = jobId.toString();
      if (state.jobs[key]) continue;
      state.jobs[key] = { jobId: key, status: JOB_STATUS_NAMES[JobStatus.Open], attempts: 0, done: false, updatedAt: Date.now() };
      emit({ type: "discovered", jobId });
    }
    return page.now;
  }

  async function runHandler(job: TrackedJob, jobId: bigint, capability: string, input: string, client: string, budget: bigint): Promise<string> {
    const handler = handlers[capability]!;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`handler ${capability} exceeded ${handlerTimeoutMs} ms`)), handlerTimeoutMs);
    try {
      touch(job, { attempts: job.attempts + 1, capability });
      emit({ type: "working", jobId, capability, attempt: job.attempts });
      return await handler({ jobId, capability, input, client, budget, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function work(job: TrackedJob, now: bigint): Promise<void> {
    const jobId = BigInt(job.jobId);
    const record = await chain.getJob(jobId);
    touch(job, { status: JOB_STATUS_NAMES[record.status] });
    switch (record.status) {
      case JobStatus.Open:
        return;
      case JobStatus.Funded: {
        let content = job.content;
        if (content === undefined) {
          if (job.attempts >= maxAttempts) {
            if (!job.done) {
              touch(job, { done: true });
              emit({ type: "unserviceable", jobId, reason: `the handler failed ${job.attempts} time(s): ${job.error ?? "no detail"}` });
            }
            return;
          }
          const chosen = capabilityFor(record.description);
          if ("reason" in chosen) {
            touch(job, { done: true, error: chosen.reason });
            emit({ type: "unserviceable", jobId, reason: chosen.reason });
            return;
          }
          const minimum = options.minimumBudgetFor?.(chosen.capability);
          if (minimum !== undefined && record.budget < minimum) {
            const reason = `funded with ${record.budget} but ${chosen.capability} costs ${minimum} (base units)`;
            touch(job, { done: true, capability: chosen.capability, error: reason });
            emit({ type: "unserviceable", jobId, reason });
            return;
          }
          try {
            content = await runHandler(job, jobId, chosen.capability, chosen.input, record.client, record.budget);
            touch(job, { content, error: undefined });
          } catch (error) {
            touch(job, { error: describe(error) });
            emit({ type: "error", jobId, step: "handler", error });
            return;
          }
        }
        try {
          const { deliverable, hash } = await chain.submit(jobId, content);
          touch(job, { deliverable, submittedIn: hash, status: JOB_STATUS_NAMES[JobStatus.Submitted], error: undefined });
          emit({ type: "submitted", jobId, deliverable, hash });
        } catch (error) {
          touch(job, { error: describe(error) });
          emit({ type: "error", jobId, step: "submit", error });
        }
        return;
      }
      case JobStatus.Submitted: {
        if (record.finalizeAfter === undefined || now < record.finalizeAfter) return;
        try {
          const { hash } = await chain.finalize(jobId);
          touch(job, { finalizedIn: hash, status: JOB_STATUS_NAMES[JobStatus.Completed], error: undefined });
          emit({ type: "finalized", jobId, hash });
        } catch (error) {
          // Inside the window by the ledger's clock (WindowOpen), or the client rejected meanwhile: read again next tick.
          touch(job, { error: describe(error) });
          emit({ type: "error", jobId, step: "finalize", error });
        }
        return;
      }
      case JobStatus.Completed:
        // Settled once withdrawn, by `settle`.
        return;
      case JobStatus.Rejected:
      case JobStatus.Expired:
        if (!job.done) {
          touch(job, { done: true });
          emit({ type: "closed", jobId, status: JOB_STATUS_NAMES[record.status] });
        }
        return;
    }
  }

  /** Everything credited is pulled at once: the balance is the account's, not a job's. */
  async function settle(): Promise<void> {
    const completed = Object.values(state.jobs).filter((job) => job.status === JOB_STATUS_NAMES[JobStatus.Completed] && job.withdrawnIn === undefined);
    if (completed.length === 0) return;
    try {
      const amount = await chain.withdrawable();
      if (amount === 0n) {
        for (const job of completed) touch(job, { withdrawnIn: "already withdrawn", done: true });
        return;
      }
      const { hash } = await chain.withdraw(amount);
      for (const job of completed) touch(job, { withdrawnIn: hash, done: true });
      emit({ type: "withdrawn", amount, hash });
    } catch (error) {
      emit({ type: "error", jobId: undefined, step: "withdraw", error });
    }
  }

  async function pass(): Promise<void> {
    await load();
    let now: bigint;
    try {
      now = await discover();
    } catch (error) {
      emit({ type: "error", jobId: undefined, step: "discover", error });
      await save();
      return;
    }
    for (const job of Object.values(state.jobs)) {
      if (job.done) continue;
      try {
        await work(job, now);
      } catch (error) {
        touch(job, { error: describe(error) });
        emit({ type: "error", jobId: BigInt(job.jobId), step: "read", error });
      }
    }
    await settle();
    await save();
  }

  const provider: Provider = {
    state,
    tick() {
      const next = (running ?? Promise.resolve()).then(pass, pass);
      running = next.finally(() => {
        if (running === next) running = undefined;
      });
      return next;
    },
    start(intervalMs) {
      if (timer) return;
      stopped = false;
      const loop = () => {
        if (stopped) return;
        void provider.tick().finally(() => {
          if (!stopped) timer = setTimeout(loop, intervalMs);
        });
      };
      timer = setTimeout(loop, 0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await running;
    },
    jobs: () => Object.values(state.jobs).sort((a, b) => Number(BigInt(a.jobId) - BigInt(b.jobId))),
    job: (jobId) => state.jobs[jobId.toString()],
  };
  return provider;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
