import { platformFee as platformFeeOf, type JobStatusName } from "./job";
import { jobPhase, type JobPhase } from "./phase";
import type { JobSummary } from "./square";

export const chartColors = {
  carbon: "#181925",
  graphite: "#666666",
  ash: "#999999",
  fog: "#e8e8e8",
  mist: "#f5f5f5",
  paper: "#ffffff",
  lavender: "#918df6",
  iris: "#9580ff",
  mint: "#33c758",
  mintWash: "#def6e4",
  amber: "#ffa600",
  sky: "#2c78fc",
  magenta: "#d6409f",
  ember: "#ff3e00",
} as const;

export const chartFont = "OpenRunde, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const phaseColor: Record<JobPhase, string> = {
  open: chartColors.sky,
  "needs-budget": chartColors.graphite,
  funded: chartColors.iris,
  refundable: chartColors.magenta,
  "in-window": chartColors.amber,
  finalizable: chartColors.amber,
  completed: chartColors.mint,
  rejected: chartColors.magenta,
  expired: chartColors.ash,
};

export const PHASE_ORDER: JobPhase[] = ["needs-budget", "open", "funded", "in-window", "finalizable", "refundable", "completed", "rejected", "expired"];

export const HOUR = 3_600;
export const DAY = 86_400;

export function bucketSize(spanSeconds: number): number {
  return spanSeconds <= 3 * DAY ? HOUR : DAY;
}

export function bucketOf(timestamp: number, size: number): number {
  return Math.floor(timestamp / size) * size;
}

/** Base units as a chart number: seven decimals, the Stellar unit. */
export function tokens(value: bigint): number {
  return Number(value) / 10_000_000;
}

export interface FlowPoint {
  time: number;
  funded: number;
  submitted: number;
  cumulativeFunded: number;
  cumulativeSubmitted: number;
}

export interface FlowSeries {
  bucket: number;
  points: FlowPoint[];
  totalFunded: number;
  totalSubmitted: number;
}

export function escrowFlow(jobs: readonly JobSummary[]): FlowSeries {
  const funded = jobs.filter((job) => job.fundedAt > 0);
  const submitted = jobs.filter((job) => job.submittedAt > 0);
  const stamps = [...funded.map((job) => job.fundedAt), ...submitted.map((job) => job.submittedAt)];
  if (stamps.length === 0) return { bucket: HOUR, points: [], totalFunded: 0, totalSubmitted: 0 };
  const span = Math.max(...stamps) - Math.min(...stamps);
  const bucket = bucketSize(span);
  const byBucket = new Map<number, { funded: number; submitted: number }>();
  const touch = (time: number) => {
    const key = bucketOf(time, bucket);
    const entry = byBucket.get(key) ?? { funded: 0, submitted: 0 };
    byBucket.set(key, entry);
    return entry;
  };
  for (const job of funded) touch(job.fundedAt).funded += tokens(job.budget);
  for (const job of submitted) touch(job.submittedAt).submitted += tokens(job.budget);
  const first = Math.min(...byBucket.keys());
  const last = Math.max(...byBucket.keys());
  const points: FlowPoint[] = [];
  let cumulativeFunded = 0;
  let cumulativeSubmitted = 0;
  for (let time = first; time <= last; time += bucket) {
    const entry = byBucket.get(time) ?? { funded: 0, submitted: 0 };
    cumulativeFunded += entry.funded;
    cumulativeSubmitted += entry.submitted;
    points.push({ time, funded: entry.funded, submitted: entry.submitted, cumulativeFunded, cumulativeSubmitted });
  }
  return { bucket, points, totalFunded: cumulativeFunded, totalSubmitted: cumulativeSubmitted };
}

export interface PhaseSlice {
  phase: JobPhase;
  label: string;
  count: number;
  budget: number;
  color: string;
}

export function phaseBreakdown(jobs: readonly JobSummary[], now: number, labels: Record<JobPhase, string>): PhaseSlice[] {
  const slices = new Map<JobPhase, PhaseSlice>();
  for (const phase of PHASE_ORDER) slices.set(phase, { phase, label: labels[phase], count: 0, budget: 0, color: phaseColor[phase] });
  for (const job of jobs) {
    const slice = slices.get(jobPhase(job, now));
    if (!slice) continue;
    slice.count += 1;
    slice.budget += tokens(job.budget);
  }
  return [...slices.values()].filter((slice) => slice.count > 0);
}

export interface PayoutSplit {
  budget: number;
  platformFee: number;
  /** What `finalize` credits the provider: the budget less the fee. */
  payout: number;
}

/** The kernel's own arithmetic in tokens: truncated basis points off the budget. */
export function payoutSplit(record: { budget: bigint; platformFeeBps: number }): PayoutSplit {
  const budget = tokens(record.budget);
  const platformFee = tokens(platformFeeOf(record));
  return { budget, platformFee, payout: budget - platformFee };
}

export interface FeeTotals {
  platform: number;
  /** Credited to providers by `finalize`. */
  netPaid: number;
  /** Credited back to clients by `reject` and `claim_refund`. */
  refunded: number;
  completed: number;
  rejected: number;
  refundedJobs: number;
}

/**
 * Where the escrow of the terminal jobs went. A rejected job only refunds
 * what was escrowed, so one rejected while still Open counts as neither.
 */
export function feeTotals(jobs: readonly JobSummary[]): FeeTotals {
  const totals: FeeTotals = { platform: 0, netPaid: 0, refunded: 0, completed: 0, rejected: 0, refundedJobs: 0 };
  for (const job of jobs) {
    if (job.status === "Completed") {
      const split = payoutSplit(job);
      totals.platform += split.platformFee;
      totals.netPaid += split.payout;
      totals.completed += 1;
    } else if (job.status === "Rejected" && job.fundedAt > 0) {
      totals.refunded += tokens(job.budget);
      totals.rejected += 1;
    } else if (job.status === "Expired") {
      totals.refunded += tokens(job.budget);
      totals.refundedJobs += 1;
    }
  }
  return totals;
}

export interface ClockSegment {
  key: string;
  label: string;
  from: number;
  to: number;
  color: string;
  state: "done" | "live" | "future";
}

export interface ClockMark {
  key: string;
  label: string;
  at: number;
  emphasis?: boolean;
}

export interface SettlementClock {
  start: number;
  end: number;
  segments: ClockSegment[];
  marks: ClockMark[];
  now: number;
  expiresAt: number;
  expiryOnScale: boolean;
}

export function settlementClock(input: {
  createdAt: number;
  fundedAt: number;
  submittedAt: number;
  expiredAt: number;
  /** `submittedAt + challengeWindow`; zero until submitted. */
  finalizeAfter: number;
  status: JobStatusName;
  now: number;
}): SettlementClock {
  const { now } = input;
  const segments: ClockSegment[] = [];
  const marks: ClockMark[] = [{ key: "created", label: "Created", at: input.createdAt }];
  const state = (from: number, to: number): ClockSegment["state"] => (now >= to ? "done" : now >= from ? "live" : "future");
  const settled = input.status === "Completed" || input.status === "Rejected" || input.status === "Expired";
  const fundedAt = input.fundedAt > 0 ? input.fundedAt : null;
  const submittedAt = input.submittedAt > 0 ? input.submittedAt : null;
  const openEnd = fundedAt ?? (settled ? input.createdAt : Math.min(now, input.expiredAt));
  segments.push({ key: "open", label: "Open", from: input.createdAt, to: Math.max(openEnd, input.createdAt), color: chartColors.sky, state: fundedAt ? "done" : state(input.createdAt, input.expiredAt) });
  if (fundedAt) {
    marks.push({ key: "funded", label: "Funded", at: fundedAt });
    const fundedEnd = submittedAt ?? (settled ? fundedAt : Math.min(now, input.expiredAt));
    segments.push({ key: "funded", label: "Funded", from: fundedAt, to: Math.max(fundedEnd, fundedAt), color: chartColors.iris, state: submittedAt ? "done" : state(fundedAt, input.expiredAt) });
  }
  if (submittedAt) {
    marks.push({ key: "submitted", label: "Submitted", at: submittedAt });
    if (input.finalizeAfter > submittedAt) {
      segments.push({ key: "challenge", label: "Challenge window", from: submittedAt, to: input.finalizeAfter, color: chartColors.amber, state: state(submittedAt, input.finalizeAfter) });
      marks.push({ key: "window", label: "Window closes", at: input.finalizeAfter });
    }
  }
  const activityEnd = Math.max(...segments.map((segment) => segment.to), ...marks.map((mark) => mark.at), settled ? input.createdAt : Math.min(now, input.expiredAt));
  const activitySpan = Math.max(activityEnd - input.createdAt, 60);
  const expiryOnScale = input.expiredAt - input.createdAt <= activitySpan * 4;
  if (expiryOnScale) marks.push({ key: "expires", label: "Expires", at: input.expiredAt });
  const end = expiryOnScale ? Math.max(input.expiredAt, activityEnd) : input.createdAt + activitySpan * 1.08;
  return { start: input.createdAt, end: Math.max(end, input.createdAt + 1), segments, marks, now, expiresAt: input.expiredAt, expiryOnScale };
}

export interface ClockLabel {
  key: string;
  x: number;
  row: number;
  names: string[];
  at: number;
  emphasis: boolean;
}

export function clusterMarks(marks: readonly (ClockMark & { x: number })[], minGap = 9): ClockLabel[] {
  const sorted = [...marks].sort((left, right) => left.x - right.x);
  const clusters: ClockLabel[] = [];
  for (const mark of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && mark.x - last.x < minGap) {
      last.names.push(mark.label);
      last.emphasis = last.emphasis || mark.emphasis === true;
      continue;
    }
    clusters.push({ key: mark.key, x: mark.x, row: 0, names: [mark.label], at: mark.at, emphasis: mark.emphasis === true });
  }
  let previousX = Number.NEGATIVE_INFINITY;
  let previousRow = 1;
  for (const cluster of clusters) {
    cluster.row = cluster.x - previousX < minGap * 2 ? (previousRow === 0 ? 1 : 0) : 0;
    previousX = cluster.x;
    previousRow = cluster.row;
  }
  return clusters;
}

export function formatCompactAmount(value: number): string {
  const trim = (text: string) => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);
  if (value >= 1_000_000) return `${trim((value / 1_000_000).toFixed(2))}M`;
  if (value >= 10_000) return `${trim((value / 1_000).toFixed(1))}k`;
  if (value >= 100) return trim(value.toFixed(0));
  if (value >= 1) return trim(value.toFixed(2));
  if (value === 0) return "0";
  return trim(value.toFixed(4));
}
