import { BUYER_SALT_FLOOR, BuyerListError } from "../buyerSalt.js";
import { assertStellarAddress } from "./address.js";
import { buyerLeaf, keccak256, toHex } from "./hash.js";

/**
 * Who a receivable may be sold to, on Stellar (square#30, #16, #23).
 *
 * The same scheme as the EVM list in `../buyers.ts`: the poster publishes one
 * 32-byte root with `policy_registry.set_buyer_root(poster, Some(root))` and
 * hands each buyer its salt and path off chain; the buyer passes both to
 * `claim_market.buy`, which rebuilds the leaf from the buyer's address. Only
 * the leaf changes: `keccak256(keccak256(ScAddress XDR(buyer) ‖ salt))`
 * (`square_common::hash::buyer_leaf`) instead of `abi.encode(address, bytes32)`.
 * Leaves are sorted, pairs are hashed smaller first and an odd node is carried
 * up unchanged, which is the rule `square_common::hash::merkle_verify` and
 * OpenZeppelin's `MerkleProof` check. The reasoning is in
 * docs/decisions/buyer-eligibility.md.
 */

/** One buyer on the list, as the poster keeps it. The salt is the poster's secret. */
export interface StellarBuyerEntry {
  /** A `G…` account or a `C…` contract. */
  buyer: string;
  /** 32 bytes, `0x`-prefixed hex, at least 2^128. */
  salt: `0x${string}`;
}

/** What a buyer passes to `claim_market.buy`. */
export interface StellarBuyerEligibility {
  salt: `0x${string}`;
  proof: readonly `0x${string}`[];
}

export interface StellarBuyerList {
  /** What `set_buyer_root` publishes. */
  root: `0x${string}`;
  /** Every buyer with its salt, which the poster has to keep to issue paths later. */
  entries: readonly StellarBuyerEntry[];
  eligibilityOf(buyer: string): StellarBuyerEligibility;
}

/** 32 bytes from the platform's CSPRNG, redrawn in the 2^-128 case it lands under the floor. */
export function drawStellarBuyerSalt(): `0x${string}` {
  for (;;) {
    const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    if (BigInt(salt) >= BUYER_SALT_FLOOR) return salt;
  }
}

/** A new list for these buyers: one fresh salt each. Keep `entries`; the salts exist nowhere else. */
export function newStellarBuyerList(buyers: readonly string[]): StellarBuyerList {
  return stellarBuyerListFrom(buyers.map((buyer) => ({ buyer, salt: drawStellarBuyerSalt() })));
}

/** The list rebuilt from entries the poster kept, to issue a path or publish again. */
export function stellarBuyerListFrom(entries: readonly StellarBuyerEntry[]): StellarBuyerList {
  if (entries.length === 0) {
    throw new BuyerListError("an empty list has no root; set_buyer_root(poster, None) is how a poster admits nobody");
  }
  const seen = new Set<string>();
  const leaves = entries.map(({ buyer, salt }) => {
    assertStellarAddress(buyer, "buyer");
    if (seen.has(buyer)) throw new BuyerListError(`${buyer} is on the list twice`);
    seen.add(buyer);
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new BuyerListError(`the salt for ${buyer} is not 32 bytes of hex`);
    if (BigInt(salt) < BUYER_SALT_FLOOR) {
      throw new BuyerListError(`the salt for ${buyer} is below 2^128; draw one with drawStellarBuyerSalt()`);
    }
    return { buyer, salt, leaf: buyerLeaf(buyer, salt) };
  });
  // Sorted by leaf, so the tree says nothing about the order buyers were added in.
  const ordered = [...leaves].sort((a, b) => Buffer.compare(a.leaf, b.leaf));
  const levels = levelsOf(ordered.map((entry) => entry.leaf));
  const root = toHex(levels[levels.length - 1]![0]!);
  const indexOf = new Map(ordered.map((entry, index) => [entry.buyer, index]));
  const saltOf = new Map(ordered.map((entry) => [entry.buyer, entry.salt]));
  return {
    root,
    entries: leaves.map(({ buyer, salt }) => ({ buyer, salt })),
    eligibilityOf(buyer: string): StellarBuyerEligibility {
      const index = indexOf.get(buyer);
      if (index === undefined) throw new BuyerListError(`${buyer} is not on this list`);
      return { salt: saltOf.get(buyer)!, proof: pathOf(levels, index).map(toHex) };
    },
  };
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  const pair = new Uint8Array(64);
  pair.set(lo, 0);
  pair.set(hi, 32);
  return keccak256(pair);
}

function levelsOf(leaves: readonly Uint8Array[]): Uint8Array[][] {
  const levels: Uint8Array[][] = [[...leaves]];
  while (levels[levels.length - 1]!.length > 1) {
    const level = levels[levels.length - 1]!;
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    }
    levels.push(next);
  }
  return levels;
}

function pathOf(levels: readonly Uint8Array[][], leafIndex: number): Uint8Array[] {
  const path: Uint8Array[] = [];
  let index = leafIndex;
  for (const level of levels.slice(0, -1)) {
    const sibling = index ^ 1;
    if (sibling < level.length) path.push(level[sibling]!);
    index = Math.floor(index / 2);
  }
  return path;
}
