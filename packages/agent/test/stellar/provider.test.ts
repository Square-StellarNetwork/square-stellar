import { describe, expect, it, vi } from "vitest";
import { JobStatus, type SquareEvent, type SquareJob } from "@squaresdk/core/stellar";
import { ProviderAgent, type JobHandler } from "../../src/stellar/provider.js";

const ME = "GASLVRZFLFDCWNBWWWGY4WQQ5H3JT5F263PEHRYXXEW65NFQINLSYDHD";
const SOMEONE_ELSE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const KERNEL = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** A `funded` event as the kernel emits it: the job id and the client in the topics, the amount in the data. */
function fundedEvent(jobId: bigint, client: string, id: string): SquareEvent {
  return {
    contract: "square_job",
    contractId: KERNEL,
    name: "funded",
    topics: ["funded", jobId, client],
    data: { amount: 100_000_000n },
    ledger: 100,
    id,
    txHash: `tx-${id}`,
    position: undefined,
    inSuccessfulContractCall: true,
  };
}

function job(overrides: Partial<SquareJob> = {}): SquareJob {
  return {
    id: 1n,
    client: SOMEONE_ELSE,
    provider: ME,
    status: JobStatus.Funded,
    budget: 100_000_000n,
    platformFeeBps: 100,
    challengeWindow: 120n,
    createdAt: 1000n,
    expiredAt: 9_000n,
    fundedAt: 1100n,
    submittedAt: 0n,
    deliverable: undefined,
    description: "summarise the quarterly report",
    finalizeAfter: undefined,
    ...overrides,
  };
}

interface FakeOptions {
  events?: SquareEvent[];
  jobs?: Record<string, SquareJob>;
  withdrawable?: bigint;
}

function fakeClient(options: FakeOptions = {}) {
  const events = options.events ?? [];
  const submit = vi.fn(async (jobId: bigint) => ({ hash: `submit-${jobId}`, ledger: 101 }));
  const withdraw = vi.fn(async () => ({ hash: "withdraw-1", ledger: 102 }));
  const getEvents = vi.fn(async () => ({ events, latestLedger: 150 }));
  const client = {
    account: ME,
    deployment: { squareJob: KERNEL, network: "stellar:testnet", deployLedger: 90 },
    server: { getEvents },
    decodeEvents: () => events,
    latestLedger: async () => 150,
    getJob: vi.fn(async (jobId: bigint) => {
      const found = options.jobs?.[String(jobId)];
      if (!found) throw new Error(`no job ${jobId}`);
      return found;
    }),
    submit,
    withdraw,
    withdrawable: vi.fn(async () => options.withdrawable ?? 0n),
  };
  return { client, submit, withdraw, getEvents };
}

function agentOver(fake: ReturnType<typeof fakeClient>, handle: JobHandler, now = 5_000n): ProviderAgent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ProviderAgent({ client: fake.client as any, handle, now: () => now });
}

describe("ProviderAgent", () => {
  it("delivers a funded job that names it as the provider", async () => {
    const fake = fakeClient({ events: [fundedEvent(1n, SOMEONE_ELSE, "e1")], jobs: { "1": job() } });
    const handle = vi.fn(async () => "the report, summarised");
    const report = await agentOver(fake, handle).pass();

    expect(handle).toHaveBeenCalledOnce();
    expect(fake.submit).toHaveBeenCalledWith(1n, "the report, summarised");
    expect(report.delivered).toEqual([{ jobId: 1n, hash: "submit-1" }]);
    expect(report.cursor).toBe("e1");
  });

  it("leaves a job opened for somebody else alone, and does not say so", async () => {
    const fake = fakeClient({ events: [fundedEvent(2n, SOMEONE_ELSE, "e2")], jobs: { "2": job({ id: 2n, provider: SOMEONE_ELSE }) } });
    const handle = vi.fn(async () => "work nobody asked for");
    const report = await agentOver(fake, handle).pass();

    expect(handle).not.toHaveBeenCalled();
    expect(fake.submit).not.toHaveBeenCalled();
    expect(report.delivered).toEqual([]);
    // Another agent's job is not this agent's business, so it is not a skip
    // worth reporting: on a busy kernel that would be most of the log.
    expect(report.skipped).toEqual([]);
  });

  it("does not spend the handler on a job the kernel would refuse as expired", async () => {
    const fake = fakeClient({ events: [fundedEvent(3n, SOMEONE_ELSE, "e3")], jobs: { "3": job({ id: 3n, expiredAt: 4_000n }) } });
    const handle = vi.fn(async () => "too late");
    const report = await agentOver(fake, handle, 5_000n).pass();

    expect(handle).not.toHaveBeenCalled();
    expect(fake.submit).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([{ jobId: 3n, reason: "expired at 4000" }]);
  });

  it("skips a job that is no longer Funded, which is what makes a restart safe", async () => {
    const fake = fakeClient({ events: [fundedEvent(4n, SOMEONE_ELSE, "e4")], jobs: { "4": job({ id: 4n, status: JobStatus.Submitted }) } });
    const report = await agentOver(fake, async () => "again").pass();

    expect(fake.submit).not.toHaveBeenCalled();
    expect(report.skipped[0]?.jobId).toBe(4n);
  });

  it("submits a job once even when its funded event is read again", async () => {
    const fake = fakeClient({ events: [fundedEvent(5n, SOMEONE_ELSE, "e5")], jobs: { "5": job({ id: 5n }) } });
    const agent = agentOver(fake, async () => "delivered");

    await agent.pass();
    await agent.pass();

    expect(fake.submit).toHaveBeenCalledOnce();
  });

  it("takes the payout home when the kernel owes it something", async () => {
    const fake = fakeClient({ withdrawable: 99_000_000n });
    const report = await agentOver(fake, async () => "").pass();

    expect(fake.withdraw).toHaveBeenCalledWith(99_000_000n);
    expect(report.withdrawn).toEqual({ amount: 99_000_000n, hash: "withdraw-1" });
  });

  it("withdraws nothing when it is owed nothing", async () => {
    const fake = fakeClient({ withdrawable: 0n });
    const report = await agentOver(fake, async () => "").pass();

    expect(fake.withdraw).not.toHaveBeenCalled();
    expect(report.withdrawn).toBeUndefined();
  });
});
