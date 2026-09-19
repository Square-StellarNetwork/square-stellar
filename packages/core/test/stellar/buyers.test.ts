import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { BUYER_SALT_FLOOR, BuyerListError } from "../../src/buyers.js";
import { drawStellarBuyerSalt, newStellarBuyerList, stellarBuyerListFrom } from "../../src/stellar/buyers.js";
import { buyerLeaf, merkleVerify } from "../../src/stellar/hash.js";

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../contracts/test-support/vectors.json", import.meta.url)), "utf8"));
const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));

describe("the Stellar buyer list (#16, #23)", () => {
  // The vectors' salts are sha256 of a label: each is above the 2^128 floor
  // (a sha256 output falls under it with probability 2^-128), so the list
  // takes them as they are, and its root is the one the contracts verify.
  const entries = vectors.buyer_leaf.map((v: { buyer: string; salt: string }) => ({ buyer: v.buyer, salt: `0x${v.salt}` as const }));

  it("builds the root and paths the contracts verify", () => {
    const aboveFloor = entries.filter((e: { salt: string }) => BigInt(e.salt) >= BUYER_SALT_FLOOR);
    expect(aboveFloor).toHaveLength(entries.length);
    const list = stellarBuyerListFrom(entries);
    expect(list.root).toBe(`0x${vectors.merkle.root}`);
    for (const v of vectors.merkle.proofs) {
      const eligibility = list.eligibilityOf(v.buyer);
      expect(eligibility.proof).toEqual(v.proof.map((p: string) => `0x${p}`));
      expect(merkleVerify(eligibility.proof, list.root, buyerLeaf(v.buyer, eligibility.salt))).toBe(true);
    }
  });

  it("gives a fresh list a path for every buyer, and none for anyone else", () => {
    const buyers = vectors.buyer_leaf.map((v: { buyer: string }) => v.buyer);
    const list = newStellarBuyerList(buyers);
    for (const buyer of buyers) {
      const { salt, proof } = list.eligibilityOf(buyer);
      expect(BigInt(salt) >= BUYER_SALT_FLOOR).toBe(true);
      expect(merkleVerify(proof, list.root, buyerLeaf(buyer, salt))).toBe(true);
      expect(merkleVerify(proof, list.root, buyerLeaf(buyer, drawStellarBuyerSalt()))).toBe(false);
    }
    expect(() => list.eligibilityOf(Keypair.random().publicKey())).toThrow(BuyerListError);
  });

  it("a one-buyer list's root is the buyer's leaf", () => {
    const [first] = entries;
    const list = stellarBuyerListFrom([first]);
    expect(hexBytes(list.root)).toEqual(buyerLeaf(first.buyer, first.salt));
    expect(list.eligibilityOf(first.buyer).proof).toEqual([]);
  });

  it("refuses an empty list, a duplicate, a short salt, a guessable salt and a non-Stellar buyer", () => {
    const [first] = entries;
    expect(() => stellarBuyerListFrom([])).toThrow(BuyerListError);
    expect(() => stellarBuyerListFrom([first, first])).toThrow(BuyerListError);
    expect(() => stellarBuyerListFrom([{ buyer: first.buyer, salt: "0x1234" }])).toThrow(BuyerListError);
    expect(() => stellarBuyerListFrom([{ buyer: first.buyer, salt: `0x${"00".repeat(31)}01` }])).toThrow(BuyerListError);
    // An EVM-shaped address: 20 bytes of hex, which no Stellar contract can pay.
    const evmShaped = `0x${Buffer.from(Keypair.random().rawPublicKey().subarray(0, 20)).toString("hex")}`;
    expect(() => stellarBuyerListFrom([{ buyer: evmShaped, salt: first.salt }])).toThrow();
  });
});
