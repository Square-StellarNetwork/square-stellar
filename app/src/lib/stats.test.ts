import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { JobSummary } from "./square";
import { liveStats, matchesQuery, relativeTime, released } from "./stats";

// Real Stellar accounts: a strkey's checksum makes an invented one a lie.
const alphaAddress = Keypair.random().publicKey();
const betaAddress = Keypair.random().publicKey();
const gammaAddress = Keypair.random().publicKey();

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 1n,
  client: alphaAddress,
  provider: betaAddress,
  evaluator: gammaAddress,
  budget: 1_000_000n,
  status: "Open",
  createdAt: 1_000,
  fundedAt: 0,
  expiredAt: 10_000,
  submittedAt: 0,
  challengeEnd: 0,
  disputed: false,
  platformFeeBp: 100,
  evaluatorFeeBp: 50,
  providerBps: 0,
  settlementHorizon: 0,
  hook: null,
  hookResolvesPayout: false,
  payee: null,
  deliverable: `0x${"00".repeat(32)}`,
  description: "A job the tests build",
  commitmentAtFund: null,
  ...over,
});

describe("liveStats", () => {
  it("counts as escrowed only what the kernel still holds, and as settled only what it released", () => {
    const stats = liveStats({
      counter: 12n,
      scanned: 3,
      jobs: [
        job({ id: 12n, status: "Completed", fundedAt: 1_100, submittedAt: 1_200, budget: 3_000_000n, providerBps: 10_000 }),
        job({ id: 11n, status: "Funded", fundedAt: 1_500 }),
        job({ id: 10n }),
      ],
    });
    expect(stats).toEqual({ totalJobs: 12n, escrowed: 1_000_000n, settled: 2_955_000n, completed: 1, active: 1, lastActivity: 1_500, scanned: 3 });
  });

  it("drops a refunded job out of the escrow total instead of keeping it there for ever", () => {
    const jobs = [
      job({ id: 3n, status: "Submitted", fundedAt: 1_100, submittedAt: 1_200, budget: 5_000_000n }),
      job({ id: 2n, status: "Expired", fundedAt: 1_050, budget: 7_000_000n }),
      job({ id: 1n, status: "Rejected", fundedAt: 1_000, budget: 9_000_000n }),
    ];
    const stats = liveStats({ counter: 3n, scanned: 3, jobs });
    expect(stats.escrowed).toBe(5_000_000n);
    expect(stats.settled).toBe(0n);
    expect(stats.active).toBe(1);
  });

  it("takes the fees and the arbiters' split off the settled total", () => {
    const stats = liveStats({
      counter: 1n,
      scanned: 1,
      jobs: [job({ id: 1n, status: "Completed", fundedAt: 1_100, submittedAt: 1_200, budget: 1_000_000n, providerBps: 4_000 })],
    });
    expect(stats.settled).toBe(394_000n);
  });
});

describe("released", () => {
  it("agrees with SquareJob.complete on the deployed fee basis points", () => {
    expect(released(job({ status: "Completed", budget: 1_000_000n, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 10_000 }))).toBe(985_000n);
    expect(released(job({ status: "Completed", budget: 1_000_000n, platformFeeBp: 0, evaluatorFeeBp: 0, providerBps: 10_000 }))).toBe(1_000_000n);
  });

  it("releases nothing to the payee when the decision gave the provider a zero share", () => {
    expect(released(job({ status: "Completed", budget: 1_000_000n, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 0 }))).toBe(0n);
  });

  it("keeps the whole net between the payee and the client on a split", () => {
    const split = job({ status: "Completed", budget: 1_000_000n, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 4_000 });
    expect(released(split)).toBe(394_000n);
    expect(985_000n - released(split)).toBe(591_000n);
  });
});

describe("relativeTime", () => {
  it("speaks in the largest unit that fits", () => {
    expect(relativeTime(990, 1_000)).toBe("just now");
    expect(relativeTime(1_000, 1_090)).toBe("1 minute ago");
    expect(relativeTime(1_000, 8_200)).toBe("2 hours ago");
    expect(relativeTime(0, 3 * 86_400)).toBe("3 days ago");
  });
});

describe("matchesQuery", () => {
  it("matches an exact id or an address fragment, case-insensitively", () => {
    const entry = job({ id: 12n });
    expect(matchesQuery(entry, "")).toBe(true);
    expect(matchesQuery(entry, "12")).toBe(true);
    expect(matchesQuery(entry, "#12")).toBe(true);
    expect(matchesQuery(entry, "1")).toBe(false);
    // A strkey is upper case, and people paste the tail of one as often as the head.
    expect(matchesQuery(entry, alphaAddress.slice(-8))).toBe(true);
    expect(matchesQuery(entry, alphaAddress.slice(-8).toLowerCase())).toBe(true);
    expect(matchesQuery(entry, betaAddress.slice(4, 14))).toBe(true);
    expect(matchesQuery(entry, gammaAddress.slice(-8))).toBe(false);
  });

  it("matches nothing on a job whose provider is not yet named", () => {
    expect(matchesQuery(job({ provider: null }), betaAddress.slice(4, 14))).toBe(false);
  });
});
