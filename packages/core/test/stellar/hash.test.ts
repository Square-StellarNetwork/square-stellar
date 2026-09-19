import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buyerLeaf,
  evidenceHash,
  finalizeReason,
  HashInputError,
  merkleVerify,
  resolutionHash,
  scAddressXdr,
  statementHash,
  toHex,
  type CheckOutcome,
  type Outcome,
} from "../../src/stellar/hash.js";

// The contracts are held to the same file: contracts/common/src/test.rs.
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../contracts/test-support/vectors.json", import.meta.url)), "utf8"));
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (b: Uint8Array) => toHex(b).slice(2);

describe("the contracts' keccak preimages (#8)", () => {
  it("finalize_reason", () => {
    expect(vectors.finalize_reason).toHaveLength(3);
    for (const v of vectors.finalize_reason) {
      expect(hex(finalizeReason(BigInt(v.job_id), bytes(v.deliverable)))).toBe(v.reason);
    }
  });

  it("resolution_hash, every outcome", () => {
    expect(vectors.resolution_hash).toHaveLength(12);
    for (const v of vectors.resolution_hash) {
      expect(hex(resolutionHash(BigInt(v.job_id), v.outcome as Outcome, v.provider_bps))).toBe(v.hash);
    }
  });

  it("statement_hash", () => {
    expect(hex(statementHash(bytes(vectors.statement_hash.signals)))).toBe(vectors.statement_hash.hash);
  });

  it("buyer_leaf, over the ScAddress XDR", () => {
    for (const v of vectors.buyer_leaf) {
      expect(hex(scAddressXdr(v.buyer))).toBe(v.sc_address_xdr);
      expect(hex(buyerLeaf(v.buyer, bytes(v.salt)))).toBe(v.leaf);
    }
  });

  it("evidence_hash, with and without a screening record", () => {
    expect(vectors.evidence_hash).toHaveLength(3);
    for (const v of vectors.evidence_hash) {
      const got = evidenceHash({
        jobId: BigInt(v.job_id),
        payee: v.payee,
        amount: BigInt(v.amount),
        token: v.asset,
        screening: v.screening === null ? null : bytes(v.screening),
        complianceOutcome: v.compliance_outcome as CheckOutcome,
        screeningOutcome: v.screening_outcome as CheckOutcome,
      });
      expect(hex(got)).toBe(v.commitment);
    }
  });

  it("merkle proofs verify, and only for their own leaf", () => {
    const root = bytes(vectors.merkle.root);
    for (const v of vectors.merkle.proofs) {
      const proof = v.proof.map(bytes);
      expect(merkleVerify(proof, root, bytes(v.leaf))).toBe(true);
      expect(merkleVerify(proof, root, new Uint8Array(32).fill(0xab))).toBe(false);
    }
  });

  it("refuses inputs the contracts could not take", () => {
    const zero = new Uint8Array(32);
    expect(() => finalizeReason(-1n, zero)).toThrow(HashInputError);
    expect(() => finalizeReason(1n << 64n, zero)).toThrow(HashInputError);
    expect(() => finalizeReason(1, new Uint8Array(31))).toThrow(HashInputError);
    expect(() => resolutionHash(1, "Complete", 2 ** 32)).toThrow(HashInputError);
    expect(() => statementHash(new Uint8Array(255))).toThrow(HashInputError);
    expect(() => buyerLeaf("0x1234", zero)).toThrow();
    expect(() => finalizeReason(1, "0x12")).toThrow(HashInputError);
    expect(() =>
      evidenceHash({ jobId: 1, payee: vectors.buyer_leaf[0].buyer, amount: 1n << 127n, token: vectors.buyer_leaf[1].buyer, screening: null, complianceOutcome: "NotRun", screeningOutcome: "NotRun" }),
    ).toThrow(HashInputError);
  });
});
