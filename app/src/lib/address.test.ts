import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { ADDRESS_FORMAT_MESSAGE, addressInputError, readAddressInput } from "./address";

const account = Keypair.random().publicKey();
const contract = new Asset("USDC", Keypair.random().publicKey()).contractId(Networks.TESTNET);

describe("readAddressInput", () => {
  it("accepts an account and a contract, and says which it is", () => {
    expect(readAddressInput(account)).toEqual({ kind: "valid", address: account, addressKind: "account" });
    expect(readAddressInput(contract)).toEqual({ kind: "valid", address: contract, addressKind: "contract" });
  });

  it("trims what a paste brings with it", () => {
    expect(readAddressInput(`  ${account}\n`)).toEqual({ kind: "valid", address: account, addressKind: "account" });
  });

  it("is empty until something is typed", () => {
    expect(readAddressInput("")).toEqual({ kind: "empty" });
    expect(readAddressInput("   ")).toEqual({ kind: "empty" });
    expect(addressInputError(readAddressInput(""))).toBeNull();
  });

  it("refuses a strkey whose checksum does not hold, which is what a typo makes", () => {
    const typo = `${account.slice(0, -1)}${account.endsWith("A") ? "B" : "A"}`;
    expect(readAddressInput(typo)).toEqual({ kind: "malformed" });
    expect(addressInputError(readAddressInput(typo))).toBe(ADDRESS_FORMAT_MESSAGE);
  });

  it("refuses a lowercased strkey, a secret seed and an EVM address", () => {
    expect(readAddressInput(account.toLowerCase())).toEqual({ kind: "malformed" });
    expect(readAddressInput(Keypair.random().secret())).toEqual({ kind: "malformed" });
    expect(readAddressInput("0x4f1397ea728005003cc351260bb5d7d00198da86")).toEqual({ kind: "malformed" });
  });
});
