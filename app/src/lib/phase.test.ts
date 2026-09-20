import { describe, expect, it } from "vitest";

import { jobPhase, PHASE_LABELS, type JobPhase } from "./phase";
import { funded, job, submitted } from "./testJob";

describe("jobPhase", () => {
  it("tells an unpriced job from a priced one", () => {
    expect(jobPhase(job({ budget: 0n }), 2_000)).toBe("needs-budget");
    expect(jobPhase(job(), 2_000)).toBe("open");
  });

  it("turns a funded job refundable at its expiry, not before", () => {
    expect(jobPhase(funded(), 9_999)).toBe("funded");
    expect(jobPhase(funded(), 10_000)).toBe("refundable");
  });

  it("follows the challenge window on a submitted job", () => {
    const live = submitted(1_200); // window 30 s → 1_230
    expect(jobPhase(live, 1_229)).toBe("in-window");
    expect(jobPhase(live, 1_230)).toBe("finalizable");
  });

  it("leaves a delivered job out of the refund path however long it waits", () => {
    expect(jobPhase(submitted(1_200), 500_000)).toBe("finalizable");
  });

  it("passes the terminal statuses straight through", () => {
    expect(jobPhase(job({ status: "Completed" }), 2_000)).toBe("completed");
    expect(jobPhase(job({ status: "Rejected" }), 2_000)).toBe("rejected");
    expect(jobPhase(job({ status: "Expired" }), 2_000)).toBe("expired");
  });
});

describe("PHASE_LABELS", () => {
  it("names every phase", () => {
    const phases: JobPhase[] = ["open", "needs-budget", "funded", "refundable", "in-window", "finalizable", "completed", "rejected", "expired"];
    for (const phase of phases) expect(PHASE_LABELS[phase].length).toBeGreaterThan(0);
  });
});
