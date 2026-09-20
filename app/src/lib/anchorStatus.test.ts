import { describe, expect, it } from "vitest";

import { sep6StatusCopy } from "./anchorStatus";

/**
 * The statuses a SEP-6 anchor actually sends, as the standard lists them.
 * Every one of them has to read correctly on both legs.
 */
const STATUSES = [
  "incomplete",
  "pending_user_transfer_start",
  "pending_user_transfer_complete",
  "pending_external",
  "pending_anchor",
  "pending_stellar",
  "pending_trust",
  "completed",
  "refunded",
  "expired",
  "error",
];

describe("sep6StatusCopy", () => {
  it("says the opposite thing on the two legs when the status means the opposite", () => {
    // Observed: a completed withdrawal told the customer "the asset is in your
    // wallet" — the reverse of what had just happened to their money.
    expect(sep6StatusCopy("completed", "deposit", "TRY")).toBe("Done. The asset is in your wallet.");
    expect(sep6StatusCopy("completed", "withdraw", "TRY")).toBe("Done. The asset left your wallet and the TRY was paid out.");
  });

  it("waits for the bank one way and for the customer's payment the other", () => {
    expect(sep6StatusCopy("pending_user_transfer_start", "deposit", "TRY")).toMatch(/bank transfer/);
    expect(sep6StatusCopy("pending_user_transfer_start", "withdraw", "TRY")).toMatch(/your payment/i);
  });

  it("names the fiat the anchor deals in rather than assuming one", () => {
    expect(sep6StatusCopy("completed", "withdraw", "EUR")).toContain("EUR");
    expect(sep6StatusCopy("pending_external", "withdraw", "EUR")).toContain("EUR");
  });

  it("has a sentence for every status the standard defines, on both legs", () => {
    for (const status of STATUSES) {
      for (const direction of ["deposit", "withdraw"] as const) {
        const copy = sep6StatusCopy(status, direction, "TRY");
        expect(copy.length, `${direction}/${status}`).toBeGreaterThan(0);
        expect(copy, `${direction}/${status}`).not.toBe("The anchor is working on it.");
      }
    }
  });

  it("falls back rather than showing an anchor's invented status raw", () => {
    expect(sep6StatusCopy("pending_moon_phase", "deposit", "TRY")).toBe("The anchor is working on it.");
  });
});
