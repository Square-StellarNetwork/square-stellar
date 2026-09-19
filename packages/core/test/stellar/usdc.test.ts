import { describe, expect, it } from "vitest";
import { AmountError, assertTokenAmount, formatUsdc, formatXlm, MAX_TOKEN_AMOUNT, usdcUnits } from "../../src/stellar/index.js";

describe("usdcUnits", () => {
  it.each([
    ["1.50", 15_000_000n],
    ["1", 10_000_000n],
    ["0.0000001", 1n],
    [".5", 5_000_000n],
    ["5.", 50_000_000n],
    ["0", 0n],
    [" 12.25 ", 122_500_000n],
    ["1844674407370.9551615", MAX_TOKEN_AMOUNT],
  ])("reads %s as %s base units", (text, units) => {
    expect(usdcUnits(text)).toBe(units);
  });

  it("takes a bigint as base units already", () => {
    expect(usdcUnits(15_000_000n)).toBe(15_000_000n);
    expect(() => usdcUnits(-1n)).toThrow(AmountError);
  });

  it.each(["1.00000001", "-1", "1e6", "1,5", "", ".", "abc", "1.5 USDC"])("refuses %j", (text) => {
    expect(() => usdcUnits(text)).toThrow(AmountError);
  });
});

describe("formatUsdc", () => {
  it.each([
    [15_000_000n, "1.5"],
    [10_000_000n, "1"],
    [1n, "0.0000001"],
    [0n, "0"],
    [122_500_000n, "12.25"],
    [-15_000_000n, "-1.5"],
  ])("writes %s as %s", (units, text) => {
    expect(formatUsdc(units)).toBe(text);
  });

  it("keeps a fixed number of fraction digits when asked, rounding half up", () => {
    expect(formatUsdc(15_000_000n, 2)).toBe("1.50");
    expect(formatUsdc(10_000_000n, 2)).toBe("1.00");
    expect(formatUsdc(1n, 2)).toBe("0.00");
    expect(formatUsdc(50_000n, 2)).toBe("0.01");
    expect(formatUsdc(49_999n, 2)).toBe("0.00");
    expect(formatUsdc(15_000_000n, 0)).toBe("2");
    expect(formatUsdc(15_000_000n, 9)).toBe("1.500000000");
  });

  it("round-trips what usdcUnits read", () => {
    for (const text of ["1.5", "0.0000001", "123456.789"]) expect(formatUsdc(usdcUnits(text))).toBe(text);
  });

  it("formats stroops as XLM the same way", () => {
    expect(formatXlm(188_125n)).toBe("0.0188125");
    expect(formatXlm(10_000_000n)).toBe("1");
  });
});

describe("assertTokenAmount", () => {
  it("passes what a record holds and refuses the rest", () => {
    expect(() => assertTokenAmount(0n)).not.toThrow();
    expect(() => assertTokenAmount(MAX_TOKEN_AMOUNT)).not.toThrow();
    expect(() => assertTokenAmount(MAX_TOKEN_AMOUNT + 1n, "budget")).toThrow(/budget exceeds the u64/);
    expect(() => assertTokenAmount(-1n, "price")).toThrow(/price cannot be negative/);
  });
});
