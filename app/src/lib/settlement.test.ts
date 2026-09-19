import { stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { bytes32Text, settlementRecord, type JournaledEvent } from "./settlement";

const TX_A = `0x${"aa".repeat(32)}`;
const TX_B = `0x${"bb".repeat(32)}`;
const PAYEE = "0x4f13000000000000000000000000000000000da86";

function event(name: string, decoded: Record<string, unknown>, at: { block: string; index: number; tx?: string } = { block: "10", index: 0 }): JournaledEvent {
  return { contract: "SquareHook", name, blockNumber: at.block, logIndex: at.index, txHash: at.tx ?? TX_A, args: { decoded } };
}

describe("a bytes32 the contracts write as text", () => {
  it("reads the module's reason strings back, and leaves other values as hex", () => {
    expect(bytes32Text(stringToHex("daily ceiling", { size: 32 }))).toBe("daily ceiling");
    expect(bytes32Text(stringToHex("proof already used", { size: 32 }))).toBe("proof already used");
    expect(bytes32Text(`0x${"00".repeat(32)}`)).toBe("");
    expect(bytes32Text(`0x${"ff".repeat(32)}`)).toBe(`0x${"ff".repeat(32)}`);
    expect(bytes32Text(42)).toBeNull();
  });
});

describe("the settlement record derived from the journal", () => {
  it("reads a verified, cleared, paid release with its registry writes", () => {
    const record = settlementRecord([
      event("PolicyPinned", { jobId: "7", client: "0x01", commitment: `0x${"11".repeat(32)}` }, { block: "8", index: 0 }),
      event("ComplianceChecked", { jobId: "7", payee: PAYEE, amount: "246250", verified: true }, { block: "10", index: 1 }),
      { ...event("ReleaseVerified", { jobId: "7", payee: PAYEE, amount: "246250", statement: "0x22" }, { block: "10", index: 2 }), contract: "ComplianceModule" },
      event("ScreeningChecked", { jobId: "7", payee: PAYEE, cleared: true }, { block: "10", index: 3 }),
      { ...event("PayoutRouted", { jobId: "7", payee: PAYEE, providerBps: 10000, providerShare: "246250", clientShare: "0" }, { block: "10", index: 4 }), contract: "SquareJob" },
      event("ReputationRecorded", { jobId: "7", agentId: "892531", outcome: 1, value: "1" }, { block: "10", index: 5 }),
      event("ValidationRecorded", { jobId: "7", requestHash: "0x33", response: 100 }, { block: "10", index: 6 }),
    ]);
    expect(record.verdict).toBe("verified");
    expect(record.refusalReason).toBeNull();
    expect(record.screening).toBe("cleared");
    expect(record.policyCommitment).toBe(`0x${"11".repeat(32)}`);
    expect(record.payout).toEqual({ payee: PAYEE, providerBps: 10000, providerShare: "246250", clientShare: "0" });
    expect(record.reputation).toEqual({ state: "recorded", outcome: "completed", agentId: "892531" });
    expect(record.validation).toBe("recorded");
    expect(record.transactions).toEqual([TX_A]);
    expect(record.events).toBe(7);
  });

  it("names the module's reason on a refusal and shows the net going back to the client", () => {
    const record = settlementRecord([
      event("ComplianceChecked", { jobId: "9", payee: PAYEE, amount: "0", verified: false }, { block: "10", index: 1 }),
      { ...event("ReleaseRefused", { jobId: "9", statement: `0x${"00".repeat(32)}`, reason: stringToHex("no proof bound", { size: 32 }) }, { block: "10", index: 2 }), contract: "ComplianceModule" },
      { ...event("PayoutRouted", { jobId: "9", payee: PAYEE, providerBps: 0, providerShare: "0", clientShare: "246250" }, { block: "10", index: 3, tx: TX_B }), contract: "SquareJob" },
      event("ReputationSkipped", { jobId: "9", agentId: "5", reason: stringToHex("untrusted evaluator", { size: 32 }) }, { block: "10", index: 4, tx: TX_B }),
    ]);
    expect(record.verdict).toBe("refused");
    expect(record.refusalReason).toBe("no proof bound");
    expect(record.payout?.providerBps).toBe(0);
    expect(record.payout?.clientShare).toBe("246250");
    expect(record.reputation).toEqual({ state: "skipped", reason: "untrusted evaluator", agentId: "5" });
    expect(record.transactions).toEqual([TX_A, TX_B]);
  });

  it("orders by chain position whatever order the rows arrived in, so the last verdict wins", () => {
    const record = settlementRecord([
      event("ReleaseUnconfirmed", { jobId: "3", payee: PAYEE, amount: "5" }, { block: "12", index: 0 }),
      event("ComplianceChecked", { jobId: "3", payee: PAYEE, amount: "5", verified: true }, { block: "11", index: 9 }),
    ]);
    expect(record.verdict).toBe("unconfirmed");
  });

  it("calls a paid job with no check not gated, and a failed check with no reason refused", () => {
    const paid = settlementRecord([{ ...event("PayoutRouted", { jobId: "1", payee: PAYEE, providerBps: 10000, providerShare: "1", clientShare: "0" }), contract: "SquareJob" }]);
    expect(paid.verdict).toBe("not-gated");
    const failed = settlementRecord([event("ComplianceChecked", { jobId: "1", payee: PAYEE, amount: "1", verified: false })]);
    expect(failed.verdict).toBe("refused");
    expect(failed.refusalReason).toBeNull();
    expect(settlementRecord([]).verdict).toBe("unknown");
  });

  it("counts tolerated hook failures and reads args written without the decoded wrapper", () => {
    const record = settlementRecord([
      { contract: "SquareJob", name: "HookFailed", blockNumber: "10", logIndex: 0, txHash: TX_A, args: { jobId: "1", hook: "0x02", selector: "0x00000000", reason: "0x" } },
      { contract: "SquareJob", name: "HookFailed", blockNumber: "10", logIndex: 1, txHash: TX_A, args: { jobId: "1", hook: "0x02", selector: "0x00000000", reason: "0x" } },
    ]);
    expect(record.hookFailures).toBe(2);
  });
});
