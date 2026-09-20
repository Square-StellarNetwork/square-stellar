/**
 * A classic payment carrying the anchor's memo (#58).
 *
 * SEP-6 answers a withdrawal with an account, a memo type and a memo, and the
 * anchor matches what arrives on chain by that memo: it is the only thing
 * tying a transfer to the customer who asked for the fiat. A Stellar Asset
 * Contract `transfer` cannot carry one — a memo is a field of the transaction,
 * and a contract invocation is not what an anchor's payment watcher reads — so
 * the off-ramp leg is an ordinary payment operation, which is what the SEP
 * intends and what every anchor watches for.
 *
 * The transaction is built here and signed by the wallet, so no key reaches
 * this module.
 */
import { Account, Asset, BASE_FEE, Horizon, Memo, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

import type { Signer } from "./signer.js";

/** The payment could not be made, and the reason is worth reading. */
export class MemoPaymentError extends Error {
  constructor(
    message: string,
    readonly resultCodes: readonly string[] = [],
  ) {
    super(message);
    this.name = "MemoPaymentError";
  }
}

export interface MemoPaymentRequest {
  networkPassphrase: string;
  /** The account the asset goes to, as the anchor named it. */
  destination: string;
  /** The asset to send; no issuer means the network's own. */
  asset: { code: string; issuer: string | undefined };
  /** A decimal amount in the asset's own units, at most seven places. */
  amount: string;
  /** The anchor's memo and how it means it to be read; SEP-6 gives both. */
  memo: string | undefined;
  memoType: string | undefined;
  /** How long the transaction stays valid. */
  timeoutSeconds?: number;
}

/** Seven decimal places, no sign, no exponent — what a Stellar amount is. */
const AMOUNT = /^\d{1,17}(\.\d{1,7})?$/;

/**
 * The memo as the anchor means it. An unknown type is refused rather than
 * dropped: a payment that arrives without the memo is one the anchor cannot
 * match to anybody, and the money is simply gone.
 */
function memoFor(memo: string | undefined, memoType: string | undefined): Memo {
  if (memo === undefined) {
    if (memoType !== undefined && memoType !== "none") {
      throw new MemoPaymentError(`the anchor asked for a ${memoType} memo and gave none`);
    }
    return Memo.none();
  }
  if (memoType === undefined) throw new MemoPaymentError(`the anchor gave the memo ${memo} without saying how to read it`);
  switch (memoType) {
    case "id":
      return Memo.id(memo);
    case "text":
      return Memo.text(memo);
    case "hash":
      // SEP-6 sends a hash memo base64-encoded; Memo.hash wants the bytes.
      return Memo.hash(Buffer.from(memo, "base64"));
    default:
      throw new MemoPaymentError(`the anchor asked for a memo of type ${memoType}, which this cannot send`);
  }
}

/**
 * The transaction, unsigned. Separate from sending it so that what goes on
 * the wire can be examined without a network.
 */
export function buildMemoPayment(source: Account, request: MemoPaymentRequest): Transaction {
  if (!AMOUNT.test(request.amount)) {
    throw new MemoPaymentError(`${request.amount || "(nothing)"} is not an amount this asset can carry: at most seven decimal places, and no sign`);
  }
  const asset = request.asset.issuer === undefined ? Asset.native() : new Asset(request.asset.code, request.asset.issuer);
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: request.networkPassphrase })
    .addOperation(Operation.payment({ destination: request.destination, asset, amount: request.amount }))
    .addMemo(memoFor(request.memo, request.memoType))
    .setTimeout(request.timeoutSeconds ?? 180)
    .build();
}

/** Horizon's own reasons for refusing, which say far more than its status. */
function resultCodesOf(error: unknown): string[] {
  const extras = (error as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } }).response?.data?.extras;
  const codes = extras?.result_codes;
  if (codes === undefined) return [];
  return [...(codes.transaction === undefined ? [] : [codes.transaction]), ...(codes.operations ?? [])];
}

export interface MemoPaymentResult {
  hash: string;
  ledger: number | undefined;
}

/**
 * Build it, have the wallet sign it, and submit it to Horizon — the ordinary
 * path for a classic transaction, and the one an anchor is watching.
 */
export async function payWithMemo(horizonUrl: string, signer: Signer, request: MemoPaymentRequest): Promise<MemoPaymentResult> {
  const horizon = new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith("http://") });
  let source: Account;
  try {
    // Horizon's answer carries more than a source needs; the sequence is what
    // the builder takes, and it must be the one on chain now.
    const loaded = await horizon.loadAccount(signer.address);
    source = new Account(loaded.accountId(), loaded.sequenceNumber());
  } catch {
    throw new MemoPaymentError(`${signer.address} is not an account on this network yet, so it cannot send a payment`);
  }

  const built = buildMemoPayment(source, request);
  const { signedTxXdr } = await signer.signTransaction(built.toXDR(), { networkPassphrase: request.networkPassphrase, address: signer.address });
  const signed = TransactionBuilder.fromXDR(signedTxXdr, request.networkPassphrase) as Transaction;

  try {
    const sent = await horizon.submitTransaction(signed);
    return { hash: sent.hash, ledger: typeof sent.ledger === "number" ? sent.ledger : undefined };
  } catch (error) {
    const codes = resultCodesOf(error);
    if (codes.includes("op_no_trust")) {
      throw new MemoPaymentError(`${request.destination} does not hold ${request.asset.code}, so it cannot be paid in it`, codes);
    }
    if (codes.includes("op_underfunded")) {
      throw new MemoPaymentError(`there is not enough ${request.asset.code} in ${signer.address} to send ${request.amount}`, codes);
    }
    if (codes.length > 0) throw new MemoPaymentError(`the network refused the payment: ${codes.join(", ")}`, codes);
    throw new MemoPaymentError(`the payment was not accepted: ${error instanceof Error ? error.message : String(error)}`);
  }
}
