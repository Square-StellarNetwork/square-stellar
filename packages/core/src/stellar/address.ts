import { Address, hash, StrKey } from "@stellar/stellar-sdk";

/**
 * A Stellar address as the contracts see one: an account (`G…`, an ed25519
 * public key) or a contract (`C…`, a 32-byte id), both as 56-character
 * strkeys. Muxed accounts (`M…`) are not addresses a contract stores or pays
 * (docs/decisions/address-field-mapping.md) and are refused everywhere here.
 */
export type AddressKind = "account" | "contract";

export class InvalidAddressError extends Error {
  constructor(
    readonly value: string,
    readonly what: string = "address",
  ) {
    super(`${what} ${JSON.stringify(value)} is not a Stellar account (G…) or contract (C…) address`);
    this.name = "InvalidAddressError";
  }
}

export function isAccountAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

export function isContractAddress(value: string): boolean {
  return StrKey.isValidContract(value);
}

export function isStellarAddress(value: string): boolean {
  return isAccountAddress(value) || isContractAddress(value);
}

export function addressKind(value: string, what?: string): AddressKind {
  if (isAccountAddress(value)) return "account";
  if (isContractAddress(value)) return "contract";
  throw new InvalidAddressError(value, what);
}

export function assertStellarAddress(value: string, what?: string): void {
  addressKind(value, what);
}

/** Case-sensitive equality is the right one: a strkey has one spelling. */
export function sameAddress(a: string, b: string): boolean {
  return a === b;
}

/**
 * `f`, the circuit's field element for an address (docs/decisions/address-field-mapping.md):
 *
 *     signal = 0x00 || sha256( XDR(ScVal::Address(addr)) )[0..31]
 *
 * The input is the XDR of the address as an `ScVal`, which is what a
 * contract's `Address::to_xdr` writes, not the bare `ScAddress`, which is the
 * same bytes without the 4-byte `SCV_ADDRESS` tag. Truncating to 31 bytes
 * keeps the value under the BN254 scalar field, so there is one encoding per
 * address and no reduction. The reference implementation is
 * contracts/probes/scripts/address-field.mjs; its vectors are the test here.
 */
export interface AddressField {
  /** The 32 signal bytes, big-endian, leading byte zero. */
  bytes: Uint8Array;
  /** The same as `0x`-prefixed hex, 66 characters. */
  hex: `0x${string}`;
  /** The same as an integer, the form a circuit input takes. */
  value: bigint;
}

export function addressField(address: string): AddressField {
  assertStellarAddress(address);
  const digest = hash(Address.fromString(address).toScVal().toXDR());
  const bytes = new Uint8Array(32);
  bytes.set(digest.subarray(0, 31), 1);
  const hex = `0x${Buffer.from(bytes).toString("hex")}` as const;
  return { bytes, hex, value: BigInt(hex) };
}
