import { describe, expect, it } from "vitest";

import { classify, walletInbox, walletJobCount } from "./inbox";
import { CLIENT, funded, job, PROVIDER, STRANGER, submitted } from "./testJob";

const now = 2_000;

describe("classify", () => {
  it("asks the client for a budget, then for the funding", () => {
    expect(classify(job({ budget: 0n }), CLIENT, now)).toBe("budget");
    expect(classify(job(), CLIENT, now)).toBe("fund");
  });

  it("asks the provider only for a budget while the job is unpriced", () => {
    expect(classify(job({ budget: 0n }), PROVIDER, now)).toBe("budget");
    expect(classify(job(), PROVIDER, now)).toBeNull();
  });

  it("asks the provider for the deliverable once the escrow is there", () => {
    expect(classify(funded(), PROVIDER, now)).toBe("submit");
    expect(classify(funded(), CLIENT, now)).toBeNull();
  });

  it("stops asking for the deliverable at the expiry, and offers the client the refund instead", () => {
    expect(classify(funded(), PROVIDER, 10_000)).toBeNull();
    expect(classify(funded(), CLIENT, 10_000)).toBe("refund");
  });

  it("gives the client the window, then gives finalize to either party", () => {
    const live = submitted(1_900); // window 30 s → 1_930
    expect(classify(live, CLIENT, 1_929)).toBe("reject");
    expect(classify(live, CLIENT, 1_930)).toBe("finalize");
    expect(classify(live, PROVIDER, 1_930)).toBe("finalize");
    expect(classify(live, PROVIDER, 1_929)).toBeNull();
  });

  it("says nothing about a job that is not this wallet's, or has settled", () => {
    expect(classify(funded(), STRANGER, now)).toBeNull();
    expect(classify(submitted(1_900), STRANGER, 5_000)).toBeNull();
    expect(classify(job({ status: "Completed" }), CLIENT, now)).toBeNull();
    expect(classify(job({ status: "Rejected" }), CLIENT, now)).toBeNull();
  });
});

describe("walletInbox", () => {
  it("groups in the order a person should act, and counts the wallet's jobs", () => {
    const jobs = [
      submitted(1_900, { id: 1n }),
      funded({ id: 2n, client: STRANGER, provider: CLIENT }),
      job({ id: 3n, client: STRANGER, provider: STRANGER }),
      job({ id: 4n, budget: 0n }),
    ];
    const groups = walletInbox(jobs, CLIENT, 1_929);
    expect(groups.map((group) => [group.kind, group.jobs.map((entry) => entry.id)])).toEqual([
      ["submit", [2n]],
      ["budget", [4n]],
      ["reject", [1n]],
    ]);
    expect(walletJobCount(jobs, CLIENT)).toBe(3);
    expect(walletInbox(jobs, undefined, 1_929)).toEqual([]);
  });

  it("gives every group a title and a body", () => {
    const groups = walletInbox([funded({ client: STRANGER, provider: CLIENT })], CLIENT, now);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title.length).toBeGreaterThan(0);
    expect(groups[0]?.body.length).toBeGreaterThan(0);
  });
});
