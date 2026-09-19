import { keccak_256 } from "@noble/hashes/sha3";
import { Address } from "@stellar/stellar-sdk";

import { assertStellarAddress } from "./address.js";

/**
 * The keccak256 preimages the contracts hash (#8), byte for byte as
 * `contracts/common/src/hash.rs` lays them out: explicit fields instead of
 * `abi.encode`. Both sides are held to `contracts/test-support/vectors.json`,
 * which contracts/test-support/scripts/vectors.mjs computes a third way.
 */

export type Bytes32 = Uint8Array | `0x${string}`;

export type Outcome = "None" | "Complete" | "Reject" | "Lapsed";
export type CheckOutcome = "NotRun" | "Passed" | "Failed";

const OUTCOME_CODE: Readonly<Record<Outcome, number>> = { None: 0, Complete: 1, Reject: 2, Lapsed: 3 };
const CHECK_CODE: Readonly<Record<CheckOutcome, number>> = { NotRun: 0, Passed: 1, Failed: 2 };

const encoder = new TextEncoder();
const FINALIZE_TAG = encoder.encode("square.finalize.v1");
const RESOLUTION_TAG = encoder.encode("square.resolution.v1");
const EVIDENCE_TAG = encoder.encode("square.evidence.v1");

const U32_MAX = (1n << 32n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;

export class HashInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HashInputError";
  }
}

function bytes32(value: Bytes32, what: string): Uint8Array {
  const bytes = typeof value === "string" ? hexBytes(value, what) : value;
  if (bytes.length !== 32) throw new HashInputError(`${what} is ${bytes.length} bytes, not 32`);
  return bytes;
}

function hexBytes(value: string, what: string): Uint8Array {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new HashInputError(`${what} is not 0x-prefixed hex`);
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}

function unsigned(value: bigint | number, bits: 32 | 64, what: string): Uint8Array {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new HashInputError(`${what} ${value} is not an integer`);
  const v = BigInt(value);
  const max = bits === 32 ? U32_MAX : U64_MAX;
  if (v < 0n || v > max) throw new HashInputError(`${what} ${v} does not fit u${bits}`);
  const out = new Uint8Array(bits / 8);
  const view = new DataView(out.buffer);
  if (bits === 64) view.setBigUint64(0, v);
  else view.setUint32(0, Number(v));
  return out;
}

function i128(value: bigint, what: string): Uint8Array {
  if (value < I128_MIN || value > I128_MAX) throw new HashInputError(`${what} ${value} does not fit i128`);
  const hex = BigInt.asUintN(128, value).toString(16).padStart(32, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function keccak256(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/** `0x`-prefixed lowercase hex. */
export function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/** The XDR of the bare `ScAddress`: what `buyer_leaf` and `evidence_hash` hash, with its own type tag. */
export function scAddressXdr(address: string): Uint8Array {
  assertStellarAddress(address);
  return Uint8Array.from(Address.fromString(address).toScAddress().toXDR());
}

/** keccak256("square.finalize.v1" ‖ job_id (u64 BE) ‖ deliverable (32)): the reason the keeper completes with. */
export function finalizeReason(jobId: bigint | number, deliverable: Bytes32): Uint8Array {
  return keccak256(concat(FINALIZE_TAG, unsigned(jobId, 64, "job id"), bytes32(deliverable, "deliverable")));
}

/** keccak256("square.resolution.v1" ‖ job_id (u64 BE) ‖ outcome (u32 BE) ‖ provider_bps (u32 BE)): what arbiters vote on. */
export function resolutionHash(jobId: bigint | number, outcome: Outcome, providerBps: number): Uint8Array {
  const code = OUTCOME_CODE[outcome];
  if (code === undefined) throw new HashInputError(`${String(outcome)} is not an outcome`);
  return keccak256(concat(RESOLUTION_TAG, unsigned(jobId, 64, "job id"), unsigned(code, 32, "outcome"), unsigned(providerBps, 32, "provider bps")));
}

/** keccak256 of the eight public signals, 32 bytes each, big-endian: a proof's statement. */
export function statementHash(signals: Uint8Array): Uint8Array {
  if (signals.length !== 8 * 32) throw new HashInputError(`signals are ${signals.length} bytes, not 256`);
  return keccak256(signals);
}

/**
 * keccak256(keccak256(ScAddress XDR(buyer) ‖ salt)). A leaf hashes 32 bytes
 * and an internal node 64, so a leaf can never pass for a node
 * (docs/decisions/buyer-eligibility.md).
 */
export function buyerLeaf(buyer: string, salt: Bytes32): Uint8Array {
  return keccak256(keccak256(concat(scAddressXdr(buyer), bytes32(salt, "salt"))));
}

export interface SettlementEvidence {
  jobId: bigint | number;
  payee: string;
  /** USDC base units, 7 decimals. */
  amount: bigint;
  token: string;
  /** The screening record the verdict read, or null when screening did not run. */
  screening: Bytes32 | null;
  complianceOutcome: CheckOutcome;
  screeningOutcome: CheckOutcome;
}

/**
 * The commitment `square_hook` writes as its validation `response_hash` and
 * publishes in `EvidenceRecorded`:
 *
 *     keccak256("square.evidence.v1" ‖ job_id (u64 BE) ‖ ScAddress XDR(payee) ‖ amount (i128 BE)
 *               ‖ ScAddress XDR(token) ‖ (0x00 | 0x01 ‖ screening) ‖ compliance (u32 BE) ‖ screening (u32 BE))
 *
 * Recomputing it from an `EvidenceRecorded` event and comparing it with the
 * registry's record is how a reader checks the record.
 */
export function evidenceHash(evidence: SettlementEvidence): Uint8Array {
  const screening = evidence.screening === null ? new Uint8Array([0]) : concat(new Uint8Array([1]), bytes32(evidence.screening, "screening"));
  return keccak256(
    concat(
      EVIDENCE_TAG,
      unsigned(evidence.jobId, 64, "job id"),
      scAddressXdr(evidence.payee),
      i128(evidence.amount, "amount"),
      scAddressXdr(evidence.token),
      screening,
      unsigned(CHECK_CODE[evidence.complianceOutcome], 32, "compliance outcome"),
      unsigned(CHECK_CODE[evidence.screeningOutcome], 32, "screening outcome"),
    ),
  );
}

/** The sorted-pair keccak256 Merkle rule `claim_market` checks with (`square_common::hash::merkle_verify`). */
export function merkleVerify(proof: readonly Bytes32[], root: Bytes32, leaf: Bytes32): boolean {
  let node = bytes32(leaf, "leaf");
  for (const [i, entry] of proof.entries()) {
    const sibling = bytes32(entry, `proof[${i}]`);
    node = Buffer.compare(node, sibling) <= 0 ? keccak256(concat(node, sibling)) : keccak256(concat(sibling, node));
  }
  return Buffer.compare(node, bytes32(root, "root")) === 0;
}
