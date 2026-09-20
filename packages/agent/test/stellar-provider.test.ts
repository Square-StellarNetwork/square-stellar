import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { JobStatus } from "@squaresdk/core/stellar";
import { describe, expect, it } from "vitest";
import { createProvider, fileStore, type ProviderEvent } from "../src/stellar/index.js";
import { FakeKernel } from "./stellar-fake-kernel.js";

const AGENT = Keypair.random().publicKey();
const CLIENT = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const BUDGET = 25_000_000n;

function setup(kernel = new FakeKernel(), handlers: Record<string, (call: { input: string; capability: string }) => Promise<string>> = { summarise: async ({ input }) => `summary of ${input}` }, extra = {}) {
  const events: ProviderEvent[] = [];
  // From the kernel's first ledger, so jobs created before the first tick are found too; the default is "from now on".
  const provider = createProvider({ chain: kernel.chainFor(AGENT), handlers, startLedger: 1, onEvent: (event) => events.push(event), ...extra });
  return { kernel, provider, events, names: () => events.map((e) => e.type) };
}

describe("the provider loop", () => {
  it("finds its jobs, works them once funded, submits, finalizes after the window and withdraws", async () => {
    const { kernel, provider, events, names } = setup();
    const mine = kernel.create(CLIENT, AGENT, "the quarterly report");
    kernel.create(CLIENT, OTHER, "not for this agent");

    // Open: found, not worked.
    await provider.tick();
    expect(names()).toEqual(["discovered"]);
    expect(provider.job(mine)).toMatchObject({ status: "Open", attempts: 0, done: false });
    expect(provider.job(2n)).toBeUndefined();

    // Funded: worked and submitted in one pass; the description is the input.
    kernel.fund(mine, BUDGET);
    await provider.tick();
    expect(names()).toEqual(["discovered", "working", "submitted"]);
    const job = provider.job(mine)!;
    expect(job).toMatchObject({ status: "Submitted", capability: "summarise", content: "summary of the quarterly report", submittedIn: `submit-${mine}`, attempts: 1 });
    expect(job.deliverable).toMatch(/^[0-9a-f]{64}$/);
    expect(kernel.get(mine).status).toBe(JobStatus.Submitted);

    // Inside the window: nothing is attempted, the handler does not run again.
    await provider.tick();
    expect(kernel.calls.filter((c) => c.startsWith("finalize"))).toEqual([]);
    expect(provider.job(mine)!.attempts).toBe(1);

    // After it: finalized by the agent itself, then everything credited is withdrawn.
    kernel.advance(600n);
    await provider.tick();
    expect(events.slice(3).map((e) => e.type)).toEqual(["finalized", "withdrawn"]);
    const payout = BUDGET - (BUDGET * 250n) / 10_000n;
    expect(events.find((e) => e.type === "withdrawn")).toEqual({ type: "withdrawn", amount: payout, hash: `withdraw-${payout}` });
    expect(provider.job(mine)).toMatchObject({ status: "Completed", finalizedIn: `finalize-${mine}`, withdrawnIn: `withdraw-${payout}`, done: true });
    expect(kernel.credits.get(AGENT)).toBe(0n);

    // Done: no more reads of it.
    const reads = kernel.calls.length;
    await provider.tick();
    expect(kernel.calls.slice(reads)).toEqual(["createdJobs"]);
  });

  it("finalizes on the ledger's clock, not the wall clock, and retries when the kernel says WindowOpen", async () => {
    const { kernel, provider, names } = setup();
    const mine = kernel.create(CLIENT, AGENT, "x");
    kernel.fund(mine, BUDGET);
    await provider.tick();
    kernel.advance(599n);
    await provider.tick();
    expect(kernel.calls.filter((c) => c.startsWith("finalize"))).toEqual([]);
    kernel.advance(1n);
    await provider.tick();
    expect(names().at(-2)).toBe("finalized");
  });

  it("picks the capability the description names, or the default, or leaves the job alone", async () => {
    const handlers = { translate: async ({ input }: { input: string }) => `fr: ${input}`, summarise: async ({ input }: { input: string }) => `sum: ${input}` };
    const { kernel, provider, events } = setup(new FakeKernel(), handlers);
    const named = kernel.create(CLIENT, AGENT, "translate: bonjour");
    const bare = kernel.create(CLIENT, AGENT, "no capability named");
    kernel.fund(named, BUDGET);
    kernel.fund(bare, BUDGET);
    await provider.tick();
    expect(provider.job(named)).toMatchObject({ capability: "translate", content: "fr: bonjour", status: "Submitted" });
    expect(provider.job(bare)).toMatchObject({ done: true, status: "Funded" });
    expect(events.find((e) => e.type === "unserviceable")).toMatchObject({ jobId: bare, reason: expect.stringMatching(/names no capability/) });
    expect(kernel.calls.filter((c) => c === `submit ${bare}`)).toEqual([]);

    const withDefault = setup(new FakeKernel(), handlers, { defaultCapability: "summarise" });
    const job = withDefault.kernel.create(CLIENT, AGENT, "no capability named");
    withDefault.kernel.fund(job, BUDGET);
    await withDefault.provider.tick();
    expect(withDefault.provider.job(job)).toMatchObject({ capability: "summarise", content: "sum: no capability named" });

    // A prefix that is not a declared capability is input, not a choice.
    const single = setup(new FakeKernel(), { summarise: async ({ input }) => `sum: ${input}` });
    const odd = single.kernel.create(CLIENT, AGENT, "note: with a colon");
    single.kernel.fund(odd, BUDGET);
    await single.provider.tick();
    expect(single.provider.job(odd)).toMatchObject({ capability: "summarise", content: "sum: note: with a colon" });
  });

  it("retries a failing handler up to maxAttempts while the job is Funded, then gives up", async () => {
    let runs = 0;
    const handlers = {
      flaky: async () => {
        runs += 1;
        if (runs < 3) throw new Error(`boom ${runs}`);
        return "third time";
      },
    };
    const { kernel, provider, names } = setup(new FakeKernel(), handlers, { maxAttempts: 3 });
    const job = kernel.create(CLIENT, AGENT, "x");
    kernel.fund(job, BUDGET);
    await provider.tick();
    expect(provider.job(job)).toMatchObject({ attempts: 1, error: "boom 1", status: "Funded" });
    await provider.tick();
    await provider.tick();
    expect(provider.job(job)).toMatchObject({ attempts: 3, content: "third time", status: "Submitted", error: undefined });
    expect(names().filter((n) => n === "error")).toHaveLength(2);

    const never = setup(new FakeKernel(), { bad: async () => Promise.reject(new Error("always")) }, { maxAttempts: 2 });
    const doomed = never.kernel.create(CLIENT, AGENT, "x");
    never.kernel.fund(doomed, BUDGET);
    await never.provider.tick();
    await never.provider.tick();
    await never.provider.tick();
    expect(never.provider.job(doomed)).toMatchObject({ attempts: 2, done: true });
    expect(never.events.find((e) => e.type === "unserviceable")).toMatchObject({ reason: expect.stringMatching(/failed 2 time/) });
  });

  it("keeps the handler's output when submit fails and submits it on the next tick without running the handler again", async () => {
    let runs = 0;
    const { kernel, provider, names } = setup(new FakeKernel(), { once: async () => `run ${++runs}` });
    const job = kernel.create(CLIENT, AGENT, "x");
    kernel.fund(job, BUDGET);
    kernel.failNext.add("submit");
    await provider.tick();
    expect(provider.job(job)).toMatchObject({ content: "run 1", error: "submit failed (injected)" });
    expect(provider.job(job)!.submittedIn).toBeUndefined();
    await provider.tick();
    expect(provider.job(job)).toMatchObject({ content: "run 1", submittedIn: `submit-${job}`, error: undefined });
    expect(runs).toBe(1);
    expect(names()).toEqual(["discovered", "working", "error", "submitted"]);
  });

  it("stops at a client's rejection and at expiry, and never submits an expired job", async () => {
    const { kernel, provider, events } = setup();
    const rejected = kernel.create(CLIENT, AGENT, "x");
    const expired = kernel.create(CLIENT, AGENT, "y", 100n);
    kernel.fund(rejected, BUDGET);
    kernel.fund(expired, BUDGET);
    kernel.reject(rejected);
    kernel.advance(100n);
    kernel.expire(expired);
    await provider.tick();
    expect(provider.job(rejected)).toMatchObject({ status: "Rejected", done: true, attempts: 0 });
    expect(provider.job(expired)).toMatchObject({ status: "Expired", done: true, attempts: 0 });
    expect(events.filter((e) => e.type === "closed").map((e) => (e.type === "closed" ? e.status : ""))).toEqual(["Rejected", "Expired"]);

    // Rejected inside the window after a submission: read off the chain, closed, nothing else tried.
    const late = kernel.create(CLIENT, AGENT, "z");
    kernel.fund(late, BUDGET);
    await provider.tick();
    expect(kernel.get(late).status).toBe(JobStatus.Submitted);
    kernel.reject(late);
    kernel.advance(600n);
    await provider.tick();
    expect(provider.job(late)).toMatchObject({ status: "Rejected", done: true });
    expect(kernel.calls.filter((c) => c === `finalize ${late}`)).toEqual([]);
  });

  it("survives a chain that is down for a tick", async () => {
    const { kernel, provider, events } = setup();
    kernel.failNext.add("createdJobs");
    await provider.tick();
    expect(events).toEqual([{ type: "error", jobId: undefined, step: "discover", error: expect.any(Error) }]);
    const job = kernel.create(CLIENT, AGENT, "x");
    await provider.tick();
    expect(provider.job(job)).toBeDefined();
  });

  it("resumes from its state file: the cursor, the jobs, an output not yet on chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "square-agent-"));
    const path = join(dir, "state", "provider.json");
    const kernel = new FakeKernel();
    let runs = 0;
    const handlers = { work: async () => `run ${++runs}` };
    const first = createProvider({ chain: kernel.chainFor(AGENT), handlers, store: fileStore(path) });
    const job = kernel.create(CLIENT, AGENT, "x");
    kernel.fund(job, BUDGET);
    kernel.failNext.add("submit");
    await first.tick();
    const saved = JSON.parse(await readFile(path, "utf8")) as { cursor: string; jobs: Record<string, { content: string }> };
    expect(saved.cursor).toBe(String(kernel.ledger + 1));
    expect(saved.jobs[job.toString()]!.content).toBe("run 1");

    // A new process: the job is known, the output is there, only the submit is left.
    const second = createProvider({ chain: kernel.chainFor(AGENT), handlers, store: fileStore(path) });
    const before = kernel.created.length;
    await second.tick();
    expect(runs).toBe(1);
    expect(second.job(job)).toMatchObject({ content: "run 1", submittedIn: `submit-${job}` });
    expect(kernel.created.length).toBe(before);
    // A job created before the cursor by a third party is not re-discovered (the cursor moved on).
    expect(second.state.cursor).toBe(String(kernel.ledger + 1));
  });

  it("serializes ticks, and start/stop drive them on a timer", async () => {
    const { kernel, provider } = setup();
    const job = kernel.create(CLIENT, AGENT, "x");
    kernel.fund(job, BUDGET);
    await Promise.all([provider.tick(), provider.tick(), provider.tick()]);
    expect(kernel.calls.filter((c) => c === `submit ${job}`)).toHaveLength(1);

    const timed = setup();
    const other = timed.kernel.create(CLIENT, AGENT, "y");
    timed.kernel.fund(other, BUDGET);
    timed.provider.start(5);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await timed.provider.stop();
    expect(timed.provider.job(other)).toMatchObject({ status: "Submitted" });
    const ticks = timed.kernel.calls.filter((c) => c === "createdJobs").length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(timed.kernel.calls.filter((c) => c === "createdJobs").length).toBe(ticks);
  });
});

describe("the price", () => {
  it("leaves alone a job funded below the capability's price, before the handler runs", async () => {
    let runs = 0;
    const handlers = { summarise: async () => `run ${++runs}` };
    const { kernel, provider, events } = setup(new FakeKernel(), handlers, { minimumBudgetFor: (id: string) => (id === "summarise" ? 25_000_000n : undefined) });
    const cheap = kernel.create(CLIENT, AGENT, "underpaid");
    const fair = kernel.create(CLIENT, AGENT, "fairly paid");
    kernel.fund(cheap, 24_999_999n);
    kernel.fund(fair, 25_000_000n);
    await provider.tick();
    expect(provider.job(cheap)).toMatchObject({ done: true, capability: "summarise", attempts: 0, status: "Funded" });
    expect(events.find((e) => e.type === "unserviceable")).toMatchObject({ jobId: cheap, reason: expect.stringMatching(/funded with 24999999 but summarise costs 25000000/) });
    expect(provider.job(fair)).toMatchObject({ status: "Submitted", content: "run 1" });
    expect(runs).toBe(1);
    expect(kernel.calls.filter((c) => c === `submit ${cheap}`)).toEqual([]);
  });
});
