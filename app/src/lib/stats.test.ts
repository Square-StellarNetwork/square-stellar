import { describe, expect, it } from "vitest";

import { liveStats, matchesQuery, relativeTime, released } from "./stats";
import { CLIENT, funded, job, ONE, PROVIDER, STRANGER, submitted } from "./testJob";

describe("liveStats", () => {
  it("counts as escrowed only what the kernel still holds, and as settled only what it released", () => {
    const stats = liveStats({
      counter: 12n,
      scanned: 3,
      jobs: [
        job({ id: 12n, status: "Completed", fundedAt: 1_100, submittedAt: 1_200, budget: 3n * ONE }),
        funded({ id: 11n, fundedAt: 1_500 }),
        job({ id: 10n }),
      ],
    });
    // 3 tokens at 250 bps: 0.075 kept as the fee, 2.925 released to the provider.
    expect(stats).toEqual({ totalJobs: 12n, escrowed: ONE, settled: 29_250_000n, completed: 1, active: 1, lastActivity: 1_500, scanned: 3 });
  });

  it("drops a refunded job out of the escrow total instead of keeping it there for ever", () => {
    const jobs = [
      submitted(1_200, { id: 3n, budget: 5n * ONE }),
      job({ id: 2n, status: "Expired", fundedAt: 1_050, budget: 7n * ONE }),
      job({ id: 1n, status: "Rejected", fundedAt: 1_000, budget: 9n * ONE }),
    ];
    const stats = liveStats({ counter: 3n, scanned: 3, jobs });
    expect(stats.escrowed).toBe(5n * ONE);
    expect(stats.settled).toBe(0n);
    expect(stats.active).toBe(1);
  });
});

describe("released", () => {
  it("agrees with finalize: the budget less the platform fee, truncated", () => {
    expect(released(job({ status: "Completed", budget: ONE, platformFeeBps: 250 }))).toBe(9_750_000n);
    expect(released(job({ status: "Completed", budget: ONE, platformFeeBps: 0 }))).toBe(ONE);
  });

  it("truncates rather than rounds, as integer basis points do", () => {
    expect(released(job({ status: "Completed", budget: 9_999n, platformFeeBps: 250 }))).toBe(9_999n - 249n);
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
    // A strkey is upper case, and people paste either end of one.
    expect(matchesQuery(entry, CLIENT.slice(-8))).toBe(true);
    expect(matchesQuery(entry, CLIENT.slice(-8).toLowerCase())).toBe(true);
    expect(matchesQuery(entry, PROVIDER.slice(4, 14))).toBe(true);
    expect(matchesQuery(entry, STRANGER.slice(-8))).toBe(false);
  });
});
