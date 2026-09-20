import { addressKind, isStellarAddress } from "@squaresdk/core/stellar";

/**
 * Address input on Stellar: a strkey, either an account (`G…`) or a contract
 * (`C…`), both 56 characters with their own checksum. There is no case
 * normalisation to offer, as EIP-55 had: a strkey has one spelling, so the
 * only answers are valid and malformed.
 */
export const ADDRESS_FORMAT_MESSAGE = "Enter a Stellar address: an account (G…) or a contract (C…), 56 characters.";

export type AddressInput = { kind: "empty" } | { kind: "valid"; address: string; addressKind: "account" | "contract" } | { kind: "malformed" };

export function readAddressInput(value: string): AddressInput {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (!isStellarAddress(trimmed)) return { kind: "malformed" };
  return { kind: "valid", address: trimmed, addressKind: addressKind(trimmed) };
}

export function addressInputError(input: AddressInput): string | null {
  return input.kind === "malformed" ? ADDRESS_FORMAT_MESSAGE : null;
}
