import { Account, Asset, Keypair, Networks, Operation } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildMemoPayment, MemoPaymentError } from "../../src/stellar/payment.js";

/**
 * The off-ramp leg (#58). A SEP-6 withdrawal names an account, a memo type
 * and a memo, and the anchor matches what arrives by that memo: it is the
 * only thing tying a transfer on chain to the customer who asked for the
 * fiat. Sent without it the money reaches the anchor and belongs to nobody —
 * which is what a Stellar Asset Contract `transfer` does, since a memo is a
 * field of the transaction and a contract call is not what an anchor's
 * payment watcher reads.
 */
const wallet = Keypair.random().publicKey();
const treasury = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();

const source = (): Account => new Account(wallet, "7");
const base = {
  networkPassphrase: Networks.TESTNET,
  destination: treasury,
  asset: { code: "USDC", issuer },
  amount: "1.5",
};

describe("buildMemoPayment", () => {
  it("carries the anchor's memo, which is the whole point of the operation", () => {
    const tx = buildMemoPayment(source(), { ...base, memo: "771266276550", memoType: "id" });
    expect(tx.memo.type).toBe("id");
    expect(tx.memo.value).toBe("771266276550");
  });

  it("pays the asset the anchor issues, to the account it named", () => {
    const tx = buildMemoPayment(source(), { ...base, memo: "1", memoType: "id" });
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.type).toBe("payment");
    expect(op.destination).toBe(treasury);
    // The SDK writes an amount at the asset's full precision.
    expect(op.amount).toBe("1.5000000");
    expect((op.asset as Asset).getCode()).toBe("USDC");
    expect((op.asset as Asset).getIssuer()).toBe(issuer);
  });

  it("pays XLM when the anchor names no issuer", () => {
    const tx = buildMemoPayment(source(), { ...base, asset: { code: "XLM", issuer: undefined }, memo: "1", memoType: "id" });
    expect(((tx.operations[0] as Operation.Payment).asset as Asset).isNative()).toBe(true);
  });

  it("takes a text memo as text and a hash memo as the base64 the SEP sends", () => {
    const text = buildMemoPayment(source(), { ...base, memo: "TRMA-PQGC", memoType: "text" });
    expect(text.memo.type).toBe("text");
    expect(text.memo.value).toBe("TRMA-PQGC");

    const digest = Buffer.alloc(32, 7);
    const hash = buildMemoPayment(source(), { ...base, memo: digest.toString("base64"), memoType: "hash" });
    expect(hash.memo.type).toBe("hash");
    expect(hash.memo.value).toEqual(digest);
  });

  it("sends no memo when the anchor asked for none, rather than inventing one", () => {
    const tx = buildMemoPayment(source(), { ...base, memo: undefined, memoType: undefined });
    expect(tx.memo.type).toBe("none");
  });

  it("refuses a memo whose type it does not know, instead of dropping it", () => {
    // Dropping it is the failure this module exists to prevent: the payment
    // would go through and the anchor would never match it.
    expect(() => buildMemoPayment(source(), { ...base, memo: "1", memoType: "return" })).toThrow(MemoPaymentError);
    expect(() => buildMemoPayment(source(), { ...base, memo: "1", memoType: "return" })).toThrow(/return/);
  });

  it("refuses a memo the anchor gave without saying how to read it", () => {
    expect(() => buildMemoPayment(source(), { ...base, memo: "771266276550", memoType: undefined })).toThrow(MemoPaymentError);
  });

  it("refuses an amount the asset cannot carry, before it is signed", () => {
    expect(() => buildMemoPayment(source(), { ...base, amount: "1.00000001", memo: "1", memoType: "id" })).toThrow(MemoPaymentError);
    expect(() => buildMemoPayment(source(), { ...base, amount: "-1", memo: "1", memoType: "id" })).toThrow(MemoPaymentError);
    expect(() => buildMemoPayment(source(), { ...base, amount: "", memo: "1", memoType: "id" })).toThrow(MemoPaymentError);
  });
});
