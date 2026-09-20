import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { classify, walletInbox, walletJobCount } from "./inbox";
import type { JobSummary } from "./square";

// Real Stellar accounts: a strkey's checksum makes an invented one a lie.
const alphaAddress = Keypair.random().publicKey();
const betaAddress = Keypair.random().publicKey();
const gammaAddress = Keypair.random().publicKey();
const deltaAddress = Keypair.random().publicKey();

const me = alphaAddress;
const other = betaAddress;
const keeper = gammaAddress;
const thirdParty = deltaAddress;

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 1n,
  client: me,
  provider: other,
  evaluator: keeper,
  budget: 10_000_000n,
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

describe("classify", () => {
  const now = 2_000;

  it("asks the client for a budget, then for funding", () => {
    expect(classify(job({ budget: 0n }), me, keeper, now)).toBe("budget");
    expect(classify(job({}), me, keeper, now)).toBe("fund");
    expect(classify(job({ provider: null }), me, keeper, now)).toBeNull();
  });

  it("asks the provider for the deliverable while funded and live", () => {
    expect(classify(job({ status: "Funded", client: other, provider: me }), me, keeper, now)).toBe("submit");
    expect(classify(job({ status: "Funded" }), me, keeper, now)).toBeNull();
    expect(classify(job({ status: "Funded", expiredAt: 1_500 }), me, keeper, now)).toBe("refund");
    expect(classify(job({ status: "Submitted", expiredAt: 1_500, challengeEnd: 3_000 }), me, keeper, now)).toBeNull();
  });

  it("stops asking for the deliverable once the expiry is inside the job's settlement horizon", () => {
    const mine = { status: "Funded", client: other, provider: me } as const;
    expect(classify(job({ ...mine, expiredAt: 10_000, settlementHorizon: 1_020 }), me, keeper, now)).toBe("submit");
    expect(classify(job({ ...mine, expiredAt: 3_020, settlementHorizon: 1_020 }), me, keeper, now)).toBe("submit");
    expect(classify(job({ ...mine, expiredAt: 3_019, settlementHorizon: 1_020 }), me, keeper, now)).toBeNull();
    expect(classify(job({ ...mine, expiredAt: 2_500, settlementHorizon: 1_020 }), me, keeper, now)).toBeNull();
  });

  it("offers the refund on an expired submission the keeper does not evaluate, whatever the challenge window says", () => {
    expect(classify(job({ status: "Submitted", evaluator: thirdParty, expiredAt: 1_500, challengeEnd: 3_000 }), me, keeper, now)).toBe("refund");
    expect(classify(job({ status: "Submitted", evaluator: thirdParty, expiredAt: 1_500, challengeEnd: 1_800 }), me, keeper, now)).toBe("refund");
  });

  it("stays silent on a job a third party evaluates while it is still live", () => {
    expect(classify(job({ status: "Submitted", evaluator: thirdParty, challengeEnd: 3_000 }), me, keeper, now)).toBeNull();
    expect(classify(job({ status: "Submitted", evaluator: thirdParty, challengeEnd: 1_500 }), me, keeper, now)).toBeNull();
  });

  it("follows the challenge window for a submitted job", () => {
    expect(classify(job({ status: "Submitted", challengeEnd: 3_000 }), me, keeper, now)).toBe("dispute");
    expect(classify(job({ status: "Submitted", challengeEnd: 1_500 }), me, keeper, now)).toBe("finalize");
    expect(classify(job({ status: "Submitted", challengeEnd: 1_500, client: other, provider: me }), me, keeper, now)).toBe("finalize");
    expect(classify(job({ status: "Submitted", challengeEnd: 3_000, disputed: true }), me, keeper, now)).toBeNull();
  });

  it("ignores jobs that are not the wallet's, and settled ones", () => {
    expect(classify(job({ client: other }), me, keeper, now)).toBeNull();
    expect(classify(job({ status: "Completed" }), me, keeper, now)).toBeNull();
  });

  it("asks the evaluator on the record to decide a submission the keeper does not hold", () => {
    expect(classify(job({ status: "Submitted", client: other, provider: thirdParty, evaluator: me }), me, keeper, now)).toBe("evaluate");
    // The keeper's jobs settle by the window, not by a decision; a funded job is not yet the evaluator's to judge.
    expect(classify(job({ status: "Submitted", client: other, provider: thirdParty, evaluator: keeper }), keeper, keeper, now)).toBeNull();
    expect(classify(job({ status: "Funded", client: other, provider: thirdParty, evaluator: me }), me, keeper, now)).toBeNull();
  });
});

describe("walletInbox", () => {
  it("groups in the order a person should act and counts the wallet's jobs", () => {
    const jobs = [
      job({ id: 1n, status: "Submitted", challengeEnd: 500 }),
      job({ id: 2n, status: "Funded", client: other, provider: me }),
      job({ id: 3n, client: other }),
      job({ id: 4n, budget: 0n }),
      job({ id: 5n, status: "Submitted", client: other, provider: thirdParty, evaluator: me }),
    ];
    const groups = walletInbox(jobs, me, keeper, 2_000);
    expect(groups.map((group) => [group.kind, group.jobs.map((entry) => entry.id)])).toEqual([
      ["submit", [2n]],
      ["evaluate", [5n]],
      ["budget", [4n]],
      ["finalize", [1n]],
    ]);
    expect(walletJobCount(jobs, me)).toBe(4);
    expect(walletInbox(jobs, undefined, keeper, 2_000)).toEqual([]);
  });
});
