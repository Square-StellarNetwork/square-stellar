import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { minimumExpiry, refundAvailable, submitAvailable, submitDeadline } from "./actions";
import { classify } from "./inbox";
import type { JobSummary } from "./square";

// Real Stellar accounts: a strkey's checksum makes an invented one a lie.
const alphaAddress = Keypair.random().publicKey();
const betaAddress = Keypair.random().publicKey();
const gammaAddress = Keypair.random().publicKey();
const deltaAddress = Keypair.random().publicKey();

const client = alphaAddress;
const provider = betaAddress;
const keeper = gammaAddress;
const thirdParty = deltaAddress;

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 1n,
  client,
  provider,
  evaluator: keeper,
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

describe("refundAvailable", () => {
  it("follows SquareJob.claimRefund: expired, escrowed, and no evaluator holding the submission", () => {
    const expired = 20_000;
    expect(refundAvailable(job({ status: "Funded" }), keeper, expired)).toBe(true);
    expect(refundAvailable(job({ status: "Funded" }), keeper, 5_000)).toBe(false);
    expect(refundAvailable(job({ status: "Submitted" }), keeper, expired)).toBe(false);
    expect(refundAvailable(job({ status: "Submitted", evaluator: thirdParty }), keeper, expired)).toBe(true);
    expect(refundAvailable(job({ status: "Open" }), keeper, expired)).toBe(false);
    expect(refundAvailable(job({ status: "Completed" }), keeper, expired)).toBe(false);
  });

  it("does not read the challenge window, which KeeperEvaluator fills in for jobs it does not evaluate", () => {
    const submittedElsewhere = job({ status: "Submitted", evaluator: thirdParty, submittedAt: 9_000, challengeEnd: 9_120 });
    expect(refundAvailable(submittedElsewhere, keeper, 20_000)).toBe(true);
  });
});

describe("the inbox and the job page agree", () => {
  const now = 20_000;
  const cases: JobSummary[] = [
    job({ id: 1n, status: "Funded", fundedAt: 2_000 }),
    job({ id: 2n, status: "Funded", fundedAt: 2_000, expiredAt: 30_000 }),
    job({ id: 3n, status: "Submitted", submittedAt: 9_000, challengeEnd: 9_120 }),
    job({ id: 4n, status: "Submitted", evaluator: thirdParty, submittedAt: 9_000, challengeEnd: 9_120 }),
    job({ id: 5n, status: "Submitted", evaluator: thirdParty, submittedAt: 9_000, challengeEnd: 9_120, expiredAt: 30_000 }),
    job({ id: 6n, status: "Open" }),
    job({ id: 7n, status: "Completed" }),
    job({ id: 8n, status: "Expired" }),
  ];

  it("proposes the refund for exactly the same jobs", () => {
    const fromJobPage = cases.filter((entry) => refundAvailable(entry, keeper, now)).map((entry) => entry.id);
    const fromInbox = cases.filter((entry) => classify(entry, client, keeper, now) === "refund").map((entry) => entry.id);
    expect(fromInbox).toEqual(fromJobPage);
    expect(fromJobPage).toEqual([1n, 4n]);
  });
});

describe("submitAvailable", () => {
  const horizon = 1_020;

  it("follows SquareJob.submit: funded, before the expiry, and a whole settlement horizon short of it", () => {
    const funded = job({ status: "Funded", expiredAt: 10_000, settlementHorizon: horizon });
    expect(submitAvailable(funded, 8_000)).toBe(true);
    expect(submitAvailable(funded, 8_980)).toBe(true);
    expect(submitAvailable(funded, 8_981)).toBe(false);
    expect(submitAvailable(funded, 10_000)).toBe(false);
    expect(submitAvailable(funded, 10_001)).toBe(false);
  });

  it("names the deadline the contract enforces, not the expiry", () => {
    expect(submitDeadline({ expiredAt: 10_000, settlementHorizon: horizon })).toBe(8_980);
    expect(submitDeadline({ expiredAt: 10_000, settlementHorizon: 0 })).toBe(10_000);
  });

  it("is closed on every status other than Funded", () => {
    expect(submitAvailable(job({ status: "Open", expiredAt: 10_000, settlementHorizon: horizon }), 1_000)).toBe(false);
    expect(submitAvailable(job({ status: "Submitted", expiredAt: 10_000, settlementHorizon: horizon }), 1_000)).toBe(false);
    expect(submitAvailable(job({ status: "Completed", expiredAt: 10_000, settlementHorizon: horizon }), 1_000)).toBe(false);
  });

  it("reads the horizon snapshotted on the job, not one shared by every job", () => {
    const now = 9_500;
    expect(submitAvailable(job({ status: "Funded", expiredAt: 10_000, settlementHorizon: 0 }), now)).toBe(true);
    expect(submitAvailable(job({ status: "Funded", expiredAt: 10_000, settlementHorizon: horizon }), now)).toBe(false);
  });
});

describe("the inbox and the job page agree on the submit gate", () => {
  const now = 20_000;
  const horizon = 1_020;
  const cases: JobSummary[] = [
    job({ id: 1n, status: "Funded", fundedAt: 2_000, expiredAt: 30_000, settlementHorizon: horizon }),
    job({ id: 2n, status: "Funded", fundedAt: 2_000, expiredAt: 21_020, settlementHorizon: horizon }),
    job({ id: 3n, status: "Funded", fundedAt: 2_000, expiredAt: 21_019, settlementHorizon: horizon }),
    job({ id: 4n, status: "Funded", fundedAt: 2_000, expiredAt: 19_000, settlementHorizon: horizon }),
    job({ id: 5n, status: "Funded", fundedAt: 2_000, expiredAt: 20_000, settlementHorizon: 0 }),
    job({ id: 6n, status: "Submitted", submittedAt: 9_000, challengeEnd: 9_120, expiredAt: 30_000, settlementHorizon: horizon }),
    job({ id: 7n, status: "Open", expiredAt: 30_000, settlementHorizon: horizon }),
  ];

  it("proposes the submit for exactly the same jobs", () => {
    const fromJobPage = cases.filter((entry) => submitAvailable(entry, now)).map((entry) => entry.id);
    const fromInbox = cases.filter((entry) => classify(entry, provider, keeper, now) === "submit").map((entry) => entry.id);
    expect(fromInbox).toEqual(fromJobPage);
    expect(fromJobPage).toEqual([1n, 2n]);
  });

  it("leaves a funded job inside its last settlement horizon out of the submit group", () => {
    const inTheLastHorizon = job({ id: 3n, status: "Funded", fundedAt: 2_000, expiredAt: 21_019, settlementHorizon: horizon });
    expect(inTheLastHorizon.expiredAt).toBeGreaterThan(now);
    expect(submitAvailable(inTheLastHorizon, now)).toBe(false);
    expect(classify(inTheLastHorizon, provider, keeper, now)).toBeNull();
  });
});

describe("minimumExpiry", () => {
  it("leaves a whole settlement horizon of margin, because submit measures the horizon again", () => {
    expect(minimumExpiry(1_000, 420)).toEqual({ at: 1_840, horizon: 420, margin: 420 });
  });

  it("puts the floor far enough out that a job created at it is still submittable", () => {
    const now = 1_000;
    const horizon = 420;
    const floor = minimumExpiry(now, horizon);
    const submitsAtTheEndOfTheMargin = now + floor.margin;
    expect(floor.at).toBeGreaterThanOrEqual(submitsAtTheEndOfTheMargin + horizon);
  });
});
