import { SQUARE_JOB_ERRORS } from "@squaresdk/core/stellar";
import { describe, expect, it } from "vitest";

import { coveredErrorNames, errorCopy } from "./errorCopy";

/**
 * The table is held to the contract rather than to itself: the SDK's error
 * table comes from the generated bindings, so an error added to `square_job`
 * fails this test until someone writes what it means.
 */
describe("errorCopy", () => {
  const fromTheContract = Object.values(SQUARE_JOB_ERRORS);

  it("covers every error the deployed kernel can answer with", () => {
    const missing = fromTheContract.filter((name) => errorCopy(name) === null);
    expect(missing).toEqual([]);
  });

  it("names nothing the contract does not have", () => {
    const invented = coveredErrorNames().filter((name) => !fromTheContract.includes(name));
    expect(invented).toEqual([]);
  });

  it("says what happened without the contract's own vocabulary", () => {
    for (const name of fromTheContract) {
      const copy = errorCopy(name);
      expect(copy).not.toBeNull();
      expect(copy?.what.length).toBeGreaterThan(20);
      // The sentence explains the refusal; it does not just repeat its name.
      expect(copy?.what).not.toContain(name);
    }
  });

  it("gives a next step wherever there is one to give", () => {
    // The four without one are the owner's and the sweep's: nothing the
    // person at the screen can do changes them.
    const withoutNext = fromTheContract.filter((name) => errorCopy(name)?.next === undefined);
    expect(withoutNext.sort()).toEqual(["FeeTooHigh", "InvalidTtlConfig", "NoPendingOffer", "NothingToSkim", "OfferExpired", "SameOwner"]);
  });

  it("knows nothing about a name the contract never answers with", () => {
    expect(errorCopy("NotAKernelError")).toBeNull();
    expect(errorCopy(undefined)).toBeNull();
  });
});
