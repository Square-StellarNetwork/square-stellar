import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  bucketSize,
  clusterMarks,
  DAY,
  escrowFlow,
  feeTotals,
  formatCompactAmount,
  HOUR,
  payoutSplit,
  phaseBreakdown,
  settlementClock,
} from "./charts";
import { PHASE_LABELS } from "./phase";
import type { JobSummary } from "./square";

// Real Stellar accounts: a strkey's checksum makes an invented one a lie.
const CLIENT = Keypair.random().publicKey();
const PROVIDER = Keypair.random().publicKey();
const EVALUATOR = Keypair.random().publicKey();

/** Stellar amounts carry seven decimals, so one whole token is 10_000_000. */
const ONE = 10_000_000n;

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 1n,
  client: CLIENT,
  provider: PROVIDER,
  evaluator: EVALUATOR,
  budget: ONE,
  status: "Open" as const,
  createdAt: 1_000,
  fundedAt: 0,
  expiredAt: 100_000,
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

describe("escrow flow", () => {
  it("buckets by the hour under three days and by the day beyond", () => {
    expect(bucketSize(2 * DAY)).toBe(HOUR);
    expect(bucketSize(4 * DAY)).toBe(DAY);
  });

  it("sums funded and submitted budgets per bucket and runs the totals", () => {
    const series = escrowFlow([
      job({ id: 1n, budget: 2n * ONE, fundedAt: 3_600, submittedAt: 3_700 }),
      job({ id: 2n, budget: ONE, fundedAt: 7_300 }),
      job({ id: 3n, budget: 5n * ONE }),
    ]);
    expect(series.bucket).toBe(HOUR);
    expect(series.points.map((point) => [point.time, point.funded, point.submitted, point.cumulativeFunded, point.cumulativeSubmitted])).toEqual([
      [3_600, 2, 2, 2, 2],
      [7_200, 1, 0, 3, 2],
    ]);
    expect(series.totalFunded).toBe(3);
    expect(series.totalSubmitted).toBe(2);
  });

  it("is empty until something is funded", () => {
    expect(escrowFlow([job({})]).points).toEqual([]);
  });
});

describe("phase breakdown", () => {
  it("counts jobs and budgets per phase and drops empty phases", () => {
    const slices = phaseBreakdown(
      [
        job({ id: 1n, status: "Completed" as const, budget: 3n * ONE }),
        job({ id: 2n, status: "Completed" as const, budget: ONE }),
        job({ id: 3n, status: "Submitted" as const, challengeEnd: 500, submittedAt: 400 }),
      ],
      1_000,
      PHASE_LABELS,
    );
    expect(slices.map((slice) => [slice.phase, slice.count, slice.budget])).toEqual([
      ["finalizable", 1, 1],
      ["completed", 2, 4],
    ]);
  });
});

describe("payout split", () => {
  it("applies the snapshotted basis points and a decided provider share", () => {
    const split = payoutSplit({ budget: ONE, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 4_000, status: "Completed" as const }, 9_850_000n);
    expect(split.platformFee).toBeCloseTo(0.01);
    expect(split.evaluatorFee).toBeCloseTo(0.005);
    expect(split.net).toBeCloseTo(0.985);
    expect(split.providerShare).toBeCloseTo(0.394);
    expect(split.clientShare).toBeCloseTo(0.591);
  });

  it("gives the provider everything while no decision exists", () => {
    const split = payoutSplit({ budget: ONE, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 0, status: "Submitted" as const }, 0n);
    expect(split.providerBps).toBe(10_000);
    expect(split.clientShare).toBe(0);
    expect(split.net).toBeCloseTo(0.985);
  });

  it("keeps a decided zero share at zero instead of reading it as a full payout", () => {
    const split = payoutSplit({ budget: ONE, platformFeeBp: 100, evaluatorFeeBp: 50, providerBps: 0, status: "Completed" as const }, 9_850_000n);
    expect(split.providerBps).toBe(0);
    expect(split.providerShare).toBe(0);
    expect(split.clientShare).toBeCloseTo(0.985);
  });
});

describe("fee totals", () => {
  it("adds fees on completed jobs and refunds on rejected funded jobs", () => {
    const totals = feeTotals([
      job({ id: 1n, status: "Completed" as const, budget: 2n * ONE, providerBps: 10_000 }),
      job({ id: 2n, status: "Rejected" as const, budget: ONE, fundedAt: 5 }),
      job({ id: 3n, status: "Rejected" as const, budget: ONE }),
    ]);
    expect(totals).toEqual({ platform: 0.02, evaluator: 0.01, netPaid: 1.97, refunded: 1, splitToClient: 0, completed: 1, rejected: 1 });
  });

  it("splits the net of a decided job between the payee and the client, as SquareJob.complete does", () => {
    const totals = feeTotals([job({ id: 1n, status: "Completed" as const, budget: ONE, providerBps: 4_000 })]);
    expect(totals).toEqual({ platform: 0.01, evaluator: 0.005, netPaid: 0.394, refunded: 0.591, splitToClient: 0.591, completed: 1, rejected: 0 });
  });

  it("counts nothing as paid to the payee when a completed job was decided at a zero provider share", () => {
    const totals = feeTotals([job({ id: 1n, status: "Completed" as const, budget: ONE, providerBps: 0 })]);
    expect(totals.netPaid).toBe(0);
    expect(totals.refunded).toBe(0.985);
    expect(totals.splitToClient).toBe(0.985);
  });

  it("keeps the whole net accounted for on every completed job", () => {
    const totals = feeTotals([
      job({ id: 1n, status: "Completed" as const, budget: ONE, providerBps: 4_000 }),
      job({ id: 2n, status: "Completed" as const, budget: 2n * ONE, providerBps: 10_000 }),
      job({ id: 3n, status: "Rejected" as const, budget: ONE, fundedAt: 5 }),
    ]);
    expect(totals.netPaid + totals.splitToClient).toBeCloseTo(0.985 + 1.97);
    expect(totals.refunded).toBeCloseTo(totals.splitToClient + 1);
  });
});

describe("settlement clock", () => {
  const base = { createdAt: 1_000, fundedAt: 1_010, submittedAt: 1_011, expiredAt: 1_000 + 30 * DAY, challengeEnd: 1_131, disputedAt: 0, resolveBy: 0, status: "Submitted" as const };

  it("keeps a far expiry off the scale and names the live segment", () => {
    const clock = settlementClock({ ...base, now: 1_050 });
    expect(clock.expiryOnScale).toBe(false);
    expect(clock.segments.map((segment) => [segment.key, segment.state])).toEqual([
      ["open", "done"],
      ["funded", "done"],
      ["challenge", "live"],
    ]);
    expect(clock.marks.map((mark) => mark.key)).toEqual(["created", "funded", "submitted", "window"]);
  });

  it("puts a near expiry on the scale", () => {
    const clock = settlementClock({ ...base, expiredAt: 1_200, now: 1_050 });
    expect(clock.expiryOnScale).toBe(true);
    expect(clock.marks.at(-1)?.key).toBe("expires");
    expect(clock.end).toBe(1_200);
  });

  it("adds the dispute window when a dispute was opened", () => {
    const clock = settlementClock({ ...base, disputedAt: 1_020, resolveBy: 1_320, now: 1_400, status: "Completed" as const });
    expect(clock.segments.map((segment) => segment.key)).toContain("dispute");
    expect(clock.segments.every((segment) => segment.state === "done")).toBe(true);
  });
});

describe("mark clustering", () => {
  it("merges marks that would overlap and alternates rows for neighbours", () => {
    const labels = clusterMarks([
      { key: "a", label: "Created", at: 1, x: 0 },
      { key: "b", label: "Funded", at: 2, x: 2 },
      { key: "c", label: "Submitted", at: 3, x: 4 },
      { key: "d", label: "Window closes", at: 4, x: 20 },
      { key: "e", label: "Expires", at: 5, x: 100 },
    ]);
    expect(labels.map((label) => [label.names.join(", "), label.row])).toEqual([
      ["Created, Funded, Submitted", 0],
      ["Window closes", 0],
      ["Expires", 0],
    ]);
    const close = clusterMarks([
      { key: "a", label: "A", at: 1, x: 0 },
      { key: "b", label: "B", at: 2, x: 12 },
    ]);
    expect(close.map((label) => label.row)).toEqual([0, 1]);
  });
});

describe("compact amounts", () => {
  it("scales with the size of the number", () => {
    expect(formatCompactAmount(0)).toBe("0");
    expect(formatCompactAmount(0.005)).toBe("0.005");
    expect(formatCompactAmount(1.5)).toBe("1.5");
    expect(formatCompactAmount(250)).toBe("250");
    expect(formatCompactAmount(12_500)).toBe("12.5k");
    expect(formatCompactAmount(3_000_000)).toBe("3M");
  });
});
