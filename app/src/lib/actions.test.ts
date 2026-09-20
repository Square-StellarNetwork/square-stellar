import { describe, expect, it } from "vitest";

import { budgetAvailable, finalizeAvailable, fundAvailable, minimumExpiry, refundAvailable, rejectAvailable, submitAvailable, windowClosed } from "./actions";
import { CLIENT, funded, job, PROVIDER, STRANGER, submitted } from "./testJob";

/**
 * The gates the kernel enforces, as the buttons read them. Every expectation
 * here is a line in contracts/contracts/square_job/src/lib.rs.
 */

describe("set_budget", () => {
  it("is open to either party while the job is Open", () => {
    expect(budgetAvailable(job(), CLIENT)).toBe(true);
    expect(budgetAvailable(job(), PROVIDER)).toBe(true);
  });

  it("is closed to a stranger, to nobody, and once the job has moved on", () => {
    expect(budgetAvailable(job(), STRANGER)).toBe(false);
    expect(budgetAvailable(job(), null)).toBe(false);
    expect(budgetAvailable(funded(), CLIENT)).toBe(false);
  });
});

describe("fund", () => {
  it("is the client's, with a budget agreed and the expiry ahead", () => {
    expect(fundAvailable(job(), CLIENT, 2_000)).toBe(true);
  });

  it("is refused without a budget, past the expiry, and to anyone but the client", () => {
    expect(fundAvailable(job({ budget: 0n }), CLIENT, 2_000)).toBe(false);
    expect(fundAvailable(job(), CLIENT, 10_000)).toBe(false);
    expect(fundAvailable(job(), PROVIDER, 2_000)).toBe(false);
  });
});

describe("submit", () => {
  it("is the provider's while the job is Funded and unexpired", () => {
    expect(submitAvailable(funded(), PROVIDER, 2_000)).toBe(true);
  });

  it("closes at the expiry, to the second", () => {
    expect(submitAvailable(funded(), PROVIDER, 9_999)).toBe(true);
    expect(submitAvailable(funded(), PROVIDER, 10_000)).toBe(false);
  });

  it("is nobody else's, and not before the escrow is there", () => {
    expect(submitAvailable(funded(), CLIENT, 2_000)).toBe(false);
    expect(submitAvailable(job(), PROVIDER, 2_000)).toBe(false);
  });
});

describe("the challenge window", () => {
  const live = submitted(1_200); // window 30 s → finalizeAfter 1_230

  it("closes exactly at finalizeAfter", () => {
    expect(windowClosed(live, 1_229)).toBe(false);
    expect(windowClosed(live, 1_230)).toBe(true);
  });

  it("has not started while nothing is submitted", () => {
    expect(windowClosed(funded(), 9_999)).toBe(false);
  });

  it("hands finalize to anyone once it has closed, and to nobody before", () => {
    expect(finalizeAvailable(live, 1_229)).toBe(false);
    expect(finalizeAvailable(live, 1_230)).toBe(true);
    expect(finalizeAvailable(funded(), 9_999)).toBe(false);
  });
});

describe("reject", () => {
  it("is the client's at any time while Open or Funded", () => {
    expect(rejectAvailable(job(), CLIENT, 2_000)).toBe(true);
    expect(rejectAvailable(funded(), CLIENT, 9_999)).toBe(true);
  });

  it("is the client's inside the window once submitted, and not after it", () => {
    const live = submitted(1_200);
    expect(rejectAvailable(live, CLIENT, 1_229)).toBe(true);
    expect(rejectAvailable(live, CLIENT, 1_230)).toBe(false);
  });

  it("is nobody else's, ever", () => {
    expect(rejectAvailable(funded(), PROVIDER, 2_000)).toBe(false);
    expect(rejectAvailable(funded(), STRANGER, 2_000)).toBe(false);
    expect(rejectAvailable(funded(), null, 2_000)).toBe(false);
  });

  it("is closed once the job has settled", () => {
    expect(rejectAvailable(job({ status: "Completed" }), CLIENT, 2_000)).toBe(false);
  });
});

describe("claim_refund", () => {
  it("opens at the expiry on a funded job, for anyone", () => {
    expect(refundAvailable(funded(), 9_999)).toBe(false);
    expect(refundAvailable(funded(), 10_000)).toBe(true);
  });

  it("is closed on a job that was delivered: a submission stops that clock", () => {
    expect(refundAvailable(submitted(1_200), 20_000)).toBe(false);
  });

  it("is closed on a job nobody funded", () => {
    expect(refundAvailable(job(), 20_000)).toBe(false);
  });
});

describe("minimumExpiry", () => {
  it("is one window for the settlement and as much again of margin", () => {
    expect(minimumExpiry(1_000, 120)).toEqual({ at: 1_240, window: 120, margin: 120 });
  });

  it("leaves room to submit before the expiry and still run the window past it", () => {
    const floor = minimumExpiry(1_000, 30);
    expect(floor.at - 1_000).toBeGreaterThan(30);
  });
});
