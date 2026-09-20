import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * The argument and return encodings the contracts use (#8). A contract
 * function takes `ScVal`s, and `nativeToScVal` cannot guess a width: a job id
 * is a `u64`, an amount an `i128`, a fee a `u32`. Each helper names the type
 * the contract declares, so a wrong width fails here rather than on chain.
 */

export const u32 = (value: number): xdr.ScVal => nativeToScVal(value, { type: "u32" });
export const u64 = (value: bigint | number): xdr.ScVal => nativeToScVal(BigInt(value), { type: "u64" });
export const i128 = (value: bigint): xdr.ScVal => nativeToScVal(value, { type: "i128" });
export const bool = (value: boolean): xdr.ScVal => xdr.ScVal.scvBool(value);
export const str = (value: string): xdr.ScVal => nativeToScVal(value, { type: "string" });
export const sym = (value: string): xdr.ScVal => nativeToScVal(value, { type: "symbol" });
export const address = (value: string): xdr.ScVal => new Address(value).toScVal();
export const bytesN = (value: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(value));

/** `None` is `void`, `Some(x)` is `x` itself: how the host encodes an `Option`. */
export const option = (value: xdr.ScVal | null): xdr.ScVal => value ?? xdr.ScVal.scvVoid();

/** A `#[contracttype]` struct: a map keyed by field name, in the host's key order. */
export function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => new xdr.ScMapEntry({ key: sym(key), val: value }));
  return xdr.ScVal.scvMap(entries);
}

/** A `#[contracttype]` enum variant with no payload: a vector holding its name. */
export const unitVariant = (name: string): xdr.ScVal => xdr.ScVal.scvVec([sym(name)]);

/** A 32-byte value as the contracts take it, from hex with or without `0x`. */
export function bytes32FromHex(value: string): xdr.ScVal {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`not 32 bytes of hex: ${value}`);
  return bytesN(Uint8Array.from(Buffer.from(hex, "hex")));
}

export const ZERO_BYTES32: xdr.ScVal = bytesN(new Uint8Array(32));

// ------------------------------------------------------------------- reading

export const native = (value: xdr.ScVal): unknown => scValToNative(value);

export function asBigInt(value: unknown, what: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`${what} is not an integer: ${String(value)}`);
}

export function asNumber(value: unknown, what: string): number {
  const big = asBigInt(value, what);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} does not fit a number: ${big}`);
  return Number(big);
}

export function asString(value: unknown, what: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${what} is not a string: ${String(value)}`);
}

export function asBoolean(value: unknown, what: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`${what} is not a boolean: ${String(value)}`);
}

/** An `Option<T>`: the host sends `void`, which reads back as null or undefined. */
export function asOptional<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value);
}

/** A unit enum variant, which reads back as its name or as a one-element vector. */
export function asVariant(value: unknown, what: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  throw new Error(`${what} is not an enum variant: ${String(value)}`);
}

/** 32 bytes as `0x`-prefixed hex, the form the app shows and compares. */
export function asHex(value: unknown, what: string): `0x${string}` {
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  if (typeof value === "string" && /^0x[0-9a-f]*$/i.test(value)) return value.toLowerCase() as `0x${string}`;
  throw new Error(`${what} is not bytes: ${String(value)}`);
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${what} is not a struct: ${String(value)}`);
}
