/**
 * USDC on Stellar is a Stellar Asset Contract and reports 7 decimals
 * (docs/decisions/stellar-target.md, "USDC"); XLM has the same 7, as stroops.
 * Every amount in this package is base units as a bigint. These convert at
 * the edges: user input in, display out.
 */
export const USDC_DECIMALS = 7;
export const USDC_UNIT = 10_000_000n;
export const STROOPS_PER_XLM = 10_000_000n;

/**
 * The most a record may hold: `u64`, as the EVM `uint64 budget` was and as
 * the circuit's `Num2Bits(64)` bounds `amount`. Contracts take `i128` at the
 * SEP-41 boundary and refuse anything negative or above this before it reaches
 * storage (docs/decisions/auth-and-token-flow.md, decision 7).
 */
export const MAX_TOKEN_AMOUNT = (1n << 64n) - 1n;

export class AmountError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Base units of a decimal amount: `usdcUnits("1.50")` is `15000000n`. Strings
 * only, so a JavaScript number never rounds an amount on the way in; a bigint
 * is taken as base units already. More than seven fractional digits, a sign,
 * an exponent, or anything that is not digits and one point is refused.
 */
export function usdcUnits(amount: string | bigint, decimals: number = USDC_DECIMALS): bigint {
  if (typeof amount === "bigint") {
    if (amount < 0n) throw new AmountError(`an amount cannot be negative: ${amount}`);
    return amount;
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  const whole = match?.[1] ?? "";
  const fraction = match?.[2] ?? "";
  if (!match || whole.length + fraction.length === 0) throw new AmountError(`${JSON.stringify(amount)} is not a decimal amount`);
  if (fraction.length > decimals) {
    throw new AmountError(`${JSON.stringify(amount)} has more than ${decimals} decimals, which base units cannot carry`);
  }
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * A decimal string for base units: `formatUsdc(15000000n)` is `"1.5"`. With
 * `fractionDigits`, exactly that many, rounded half up; without, the
 * trailing zeros go and a whole number has no point.
 */
export function formatUnits(units: bigint, decimals: number, fractionDigits?: number): string {
  const negative = units < 0n;
  let magnitude = negative ? -units : units;
  let scale = decimals;
  if (fractionDigits !== undefined) {
    if (!Number.isInteger(fractionDigits) || fractionDigits < 0) throw new AmountError("fractionDigits must be a whole number");
    if (fractionDigits < decimals) {
      const drop = 10n ** BigInt(decimals - fractionDigits);
      magnitude = (magnitude + drop / 2n) / drop;
      scale = fractionDigits;
    } else {
      magnitude *= 10n ** BigInt(fractionDigits - decimals);
      scale = fractionDigits;
    }
  }
  const text = magnitude.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale);
  let fraction = text.slice(text.length - scale);
  if (fractionDigits === undefined) fraction = fraction.replace(/0+$/, "");
  const sign = negative && magnitude !== 0n ? "-" : "";
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function formatUsdc(units: bigint, fractionDigits?: number): string {
  return formatUnits(units, USDC_DECIMALS, fractionDigits);
}

/** Stroops as XLM, the unit a fee is quoted in. */
export function formatXlm(stroops: bigint, fractionDigits?: number): string {
  return formatUnits(stroops, 7, fractionDigits);
}

/** Refuses what a contract would refuse at its boundary, before anything is sent. */
export function assertTokenAmount(units: bigint, what: string = "amount"): void {
  if (units < 0n) throw new AmountError(`${what} cannot be negative: ${units}`);
  if (units > MAX_TOKEN_AMOUNT) throw new AmountError(`${what} exceeds the u64 a record holds: ${units} > ${MAX_TOKEN_AMOUNT}`);
}
