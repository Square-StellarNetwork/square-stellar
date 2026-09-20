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
import { funded, job, ONE, submitted } from "./testJob";

describe("escrow flow", () => {
  it("buckets by the hour under three days and by the day beyond", () => {
    expect(bucketSize(2 * DAY)).toBe(HOUR);
    expect(bucketSize(4 * DAY)).toBe(DAY);
  });

  it("sums funded and submitted budgets per bucket and runs the totals", () => {
    const series = escrowFlow([
      funded({ id: 1n, budget: 2n * ONE, fundedAt: 3_600, status: "Submitted", submittedAt: 3_700 }),
      funded({ id: 2n, budget: ONE, fundedAt: 7_300 }),
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
        submitted(400, { id: 3n, challengeWindow: 100 }),
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
  it("is the kernel's own arithmetic: the budget less the truncated fee", () => {
    const split = payoutSplit({ budget: ONE, platformFeeBps: 250 });
    expect(split.budget).toBeCloseTo(1);
    expect(split.platformFee).toBeCloseTo(0.025);
    expect(split.payout).toBeCloseTo(0.975);
  });

  it("gives the whole budget to the provider when the deployment charges nothing", () => {
    expect(payoutSplit({ budget: ONE, platformFeeBps: 0 })).toEqual({ budget: 1, platformFee: 0, payout: 1 });
  });
});

describe("fee totals", () => {
  it("adds the fee and the payout on a completed job", () => {
    const totals = feeTotals([job({ id: 1n, status: "Completed", budget: 2n * ONE, platformFeeBps: 250 })]);
    expect(totals.platform).toBeCloseTo(0.05);
    expect(totals.netPaid).toBeCloseTo(1.95);
    expect(totals.completed).toBe(1);
  });

  it("counts a rejection as refunded only when something was escrowed", () => {
    const totals = feeTotals([
      job({ id: 1n, status: "Rejected", budget: ONE, fundedAt: 5 }),
      job({ id: 2n, status: "Rejected", budget: ONE }),
    ]);
    expect(totals.refunded).toBeCloseTo(1);
    expect(totals.rejected).toBe(1);
  });

  it("counts an expired job's budget as refunded, because claim_refund credits it back", () => {
    const totals = feeTotals([job({ id: 1n, status: "Expired", budget: 3n * ONE, fundedAt: 5 })]);
    expect(totals.refunded).toBeCloseTo(3);
    expect(totals.refundedJobs).toBe(1);
    expect(totals.netPaid).toBe(0);
  });

  it("keeps every completed budget accounted for between the payout and the fee", () => {
    const jobs = [
      job({ id: 1n, status: "Completed", budget: ONE, platformFeeBps: 250 }),
      job({ id: 2n, status: "Completed", budget: 2n * ONE, platformFeeBps: 250 }),
    ];
    const totals = feeTotals(jobs);
    expect(totals.netPaid + totals.platform).toBeCloseTo(3);
  });
});

describe("settlement clock", () => {
  const base = { createdAt: 1_000, fundedAt: 1_010, submittedAt: 1_011, expiredAt: 1_000 + 30 * DAY, finalizeAfter: 1_131, status: "Submitted" as const };

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

  it("marks every segment done once the job has settled", () => {
    const clock = settlementClock({ ...base, now: 1_400, status: "Completed" as const });
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
