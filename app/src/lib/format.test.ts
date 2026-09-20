import { describe, expect, it } from "vitest";
import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";

import { addressKindLabel, formatAmount, formatBps, formatCountdown, formatDuration, parseAmount, shortAddress, shortHash } from "./format";

describe("amounts, at the seven decimals every Stellar token has", () => {
  it("prints base units with grouping and at least two decimals", () => {
    expect(formatAmount(10_000_000n)).toBe("1.00");
    expect(formatAmount(12_345_678_900n)).toBe("1,234.56789");
    expect(formatAmount(50_000n)).toBe("0.005");
    expect(formatAmount(-25_000_000n)).toBe("-2.50");
    expect(formatAmount(1n)).toBe("0.0000001");
  });

  it("parses what it prints and refuses the rest", () => {
    expect(parseAmount("1,234.56789")).toBe(12_345_678_900n);
    expect(parseAmount(" 0.5 ")).toBe(5_000_000n);
    expect(parseAmount("0.0000001")).toBe(1n);
    expect(parseAmount("1.23456789")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-1")).toBeNull();
  });

  it("round trips every amount it prints", () => {
    for (const value of [0n, 1n, 10_000_000n, 12_345_678_900n, 99_999_999_999_999n]) {
      expect(parseAmount(formatAmount(value))).toBe(value);
    }
  });
});

describe("durations and rates", () => {
  it("picks the two largest units", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3_900)).toBe("1h 5m");
    expect(formatDuration(90_000)).toBe("1d 1h");
  });

  it("counts down and closes", () => {
    expect(formatCountdown(1_100, 1_000)).toBe("1m 40s left");
    expect(formatCountdown(900, 1_000)).toBe("Closed");
  });

  it("turns basis points into a trimmed percentage", () => {
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(2_000n)).toBe("20%");
  });
});

describe("shortening", () => {
  it("keeps a strkey recognisable at both ends and leaves anything else alone", () => {
    const account = Keypair.random().publicKey();
    expect(shortAddress(account)).toBe(`${account.slice(0, 4)}\u2026${account.slice(-4)}`);
    expect(addressKindLabel(account)).toBe("account");
    const contract = new Asset("USDC", Keypair.random().publicKey()).contractId(Networks.TESTNET);
    expect(shortAddress(contract)).toBe(`${contract.slice(0, 4)}\u2026${contract.slice(-4)}`);
    expect(addressKindLabel(contract)).toBe("contract");
    expect(shortAddress("not-an-address")).toBe("not-an-address");
  });

  it("keeps the ends of a transaction hash", () => {
    expect(shortHash("ab".repeat(32))).toBe("abababababab".slice(0, 10) + "\u2026" + "ababab");
  });
});
