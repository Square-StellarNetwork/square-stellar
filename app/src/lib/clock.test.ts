import { describe, expect, it } from "vitest";

import { rejectAvailable } from "./actions";
import { chainClockOffset, chainNow, clockSkew, CLOCK_SKEW_NOTICE_SECONDS } from "./clock";
import { CLIENT, submitted } from "./testJob";

/**
 * Why the countdowns run on ledger time. The deployed kernel's challenge
 * window is short, so a browser a couple of minutes fast would judge it
 * closed the instant the provider submitted and would never draw the reject
 * button at all — on a chain that was still accepting the rejection.
 */

const SUBMITTED_AT = 1_800_000_000;
const WINDOW = 120;
const CLOSES_AT = SUBMITTED_AT + WINDOW;
const BROWSER_AHEAD_BY = 120;

const job = submitted(SUBMITTED_AT, { challengeWindow: WINDOW, expiredAt: SUBMITTED_AT + 100_000 });

function browserClockMs(chainSecond: number): number {
  return (chainSecond + BROWSER_AHEAD_BY) * 1_000;
}

describe("a browser clock two minutes ahead of the ledger", () => {
  const offset = chainClockOffset(SUBMITTED_AT, browserClockMs(SUBMITTED_AT));

  it("reads the skew off the ledger's close time and names it as the whole window", () => {
    expect(offset).toBe(-BROWSER_AHEAD_BY);
    expect(clockSkew(offset)).toEqual({ seconds: BROWSER_AHEAD_BY, ahead: true });
  });

  it("keeps reject available for every second the chain still accepts it", () => {
    for (let second = 0; second < WINDOW; second += 1) {
      const now = chainNow(offset, browserClockMs(SUBMITTED_AT + second));
      expect(now).toBe(SUBMITTED_AT + second);
      expect(rejectAvailable(job, CLIENT, now)).toBe(true);
    }
    expect(rejectAvailable(job, CLIENT, chainNow(offset, browserClockMs(CLOSES_AT)))).toBe(false);
  });

  it("hides it for the whole window when the same gate reads the browser clock instead", () => {
    for (let second = 0; second < WINDOW; second += 1) {
      const browserNow = Math.floor(browserClockMs(SUBMITTED_AT + second) / 1_000);
      expect(rejectAvailable(job, CLIENT, browserNow)).toBe(false);
    }
  });
});

describe("clockSkew", () => {
  it("stays quiet below the threshold and names the direction above it", () => {
    expect(clockSkew(0)).toBeNull();
    expect(clockSkew(CLOCK_SKEW_NOTICE_SECONDS - 1)).toBeNull();
    expect(clockSkew(-(CLOCK_SKEW_NOTICE_SECONDS - 1))).toBeNull();
    expect(clockSkew(CLOCK_SKEW_NOTICE_SECONDS)).toEqual({ seconds: CLOCK_SKEW_NOTICE_SECONDS, ahead: false });
    expect(clockSkew(-CLOCK_SKEW_NOTICE_SECONDS)).toEqual({ seconds: CLOCK_SKEW_NOTICE_SECONDS, ahead: true });
  });
});

describe("chainNow", () => {
  it("falls back to the browser clock when no ledger has been read yet", () => {
    expect(chainNow(0, 1_800_000_500_000)).toBe(1_800_000_500);
  });
});
