import { describe, expect, it } from "vitest";
import { jobPhase } from "./phase";

describe("jobPhase", () => {
  const now = 1_000;

  it("names the open and funded states", () => {
    expect(jobPhase({ status: "Open", challengeEnd: 0, disputed: false }, now)).toBe("open");
    expect(jobPhase({ status: "Funded", challengeEnd: 0, disputed: false }, now)).toBe("funded");
  });

  it("splits a submitted job by the window and the dispute flag", () => {
    expect(jobPhase({ status: "Submitted", challengeEnd: 0, disputed: false }, now)).toBe("submitted");
    expect(jobPhase({ status: "Submitted", challengeEnd: 2_000, disputed: false }, now)).toBe("in-window");
    expect(jobPhase({ status: "Submitted", challengeEnd: 900, disputed: false }, now)).toBe("finalizable");
    expect(jobPhase({ status: "Submitted", challengeEnd: 900, disputed: true }, now)).toBe("disputed");
  });

  it("passes the terminal states through", () => {
    expect(jobPhase({ status: "Completed", challengeEnd: 0, disputed: false }, now)).toBe("completed");
    expect(jobPhase({ status: "Rejected", challengeEnd: 0, disputed: false }, now)).toBe("rejected");
    expect(jobPhase({ status: "Expired", challengeEnd: 0, disputed: false }, now)).toBe("expired");
  });
});

