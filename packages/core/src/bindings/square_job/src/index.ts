import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Storage keys. `Job` and `Withdrawable` are persistent, the rest instance.
 * `Owner` and `PendingOwner` are taken by `square_common::owner`.
 */
export type DataKey = {tag: "Config", values: void} | {tag: "Ttl", values: void} | {tag: "JobCounter", values: void} | {tag: "TotalEscrowed", values: void} | {tag: "TotalWithdrawable", values: void} | {tag: "Job", values: readonly [u64]} | {tag: "Withdrawable", values: readonly [string]};


/**
 * A job. Timestamps are ledger seconds; a zero timestamp means "not yet".
 */
export interface Job {
  /**
 * Escrowed on `fund`; zero until `set_budget`.
 */
budget: u64;
  /**
 * The deployment's challenge window at creation, in seconds.
 */
challenge_window: u64;
  client: string;
  created_at: u64;
  /**
 * The hash the provider submitted.
 */
deliverable: Option<Buffer>;
  description: string;
  /**
 * After this, `fund` and `submit` refuse and `claim_refund` opens.
 */
expired_at: u64;
  funded_at: u64;
  /**
 * The deployment's fee at creation. Settings do not change, so this is
 * the fee `finalize` charges.
 */
platform_fee_bps: u32;
  provider: string;
  status: JobStatus;
  /**
 * `finalize` opens at `submitted_at + challenge_window`; `reject` closes.
 */
submitted_at: u64;
}


/**
 * The deployment's settings, fixed by the constructor.
 */
export interface Config {
  /**
 * Seconds the client has after a submission to reject.
 */
challenge_window: u64;
  /**
 * The share of a finalized budget credited to the owner.
 */
platform_fee_bps: u32;
  /**
 * The SEP-41 token every job is paid in: on testnet the native XLM
 * Stellar Asset Contract.
 */
token: string;
}

/**
 * The status of a job, in the order the EVM enum had.
 */
export enum JobStatus {
  Open = 0,
  Funded = 1,
  Submitted = 2,
  Completed = 3,
  Rejected = 4,
  Expired = 5,
}

/**
 * The kernel's error codes. Numbers are stable: the SDK maps a simulation's
 * `Error(Contract, #n)` to these names. 100–102 belong to
 * [`crate::owner::OwnerError`].
 */
export const SquareJobError = {
  /**
   * No job has this id.
   */
  1: {message:"InvalidJob"},
  /**
   * The job is not in a status this action applies to.
   */
  2: {message:"WrongStatus"},
  /**
   * The signer is not the job's client.
   */
  3: {message:"NotClient"},
  /**
   * The signer is not the job's provider.
   */
  4: {message:"NotProvider"},
  /**
   * The signer is neither the job's client nor its provider.
   */
  5: {message:"NotParty"},
  /**
   * Client and provider are the same address.
   */
  6: {message:"SameParty"},
  /**
   * `expired_at` is not after the ledger's time.
   */
  7: {message:"ExpiryTooShort"},
  /**
   * A description or reason longer than `MAX_TEXT` bytes.
   */
  8: {message:"TextTooLong"},
  /**
   * An amount that is not positive or does not fit `u64`.
   */
  9: {message:"InvalidAmount"},
  /**
   * `fund` before `set_budget`.
   */
  10: {message:"ZeroBudget"},
  /**
   * `fund`'s `expected_budget` is not the job's budget.
   */
  11: {message:"BudgetMismatch"},
  /**
   * `fund` or `submit` at or after `expired_at`.
   */
  12: {message:"Expired"},
  /**
   * `claim_refund` before `expired_at`.
   */
  13: {message:"NotExpired"},
  /**
   * `finalize` before the challenge window has passed.
   */
  14: {message:"WindowOpen"},
  /**
   * `reject` of a submission after the challenge window has passed.
   */
  15: {message:"WindowClosed"},
  /**
   * `withdraw_to` of more than the account's balance.
   */
  16: {message:"InsufficientBalance"},
  /**
   * `skim` when the token balance is fully accounted for.
   */
  17: {message:"NothingToSkim"},
  /**
   * A constructor fee above `MAX_PLATFORM_FEE_BPS`.
   */
  18: {message:"FeeTooHigh"},
  /**
   * A `TtlConfig` with a zero field.
   */
  19: {message:"InvalidTtlConfig"}
}


/**
 * The two network values the TTL rules convert with.
 */
export interface TtlConfig {
  /**
 * `ledgerTargetCloseTimeMilliseconds`; 5,000 on testnet and pubnet.
 */
ledger_close_ms: u32;
  /**
 * `minPersistentTtl`, in ledgers; 120,960 on testnet (about 7 days).
 */
min_persistent_ttl: u32;
}

/**
 * Instance-storage keys. A contract's own `DataKey` must not reuse these
 * variant names (see the crate documentation).
 */
export type OwnerKey = {tag: "Owner", values: void} | {tag: "PendingOwner", values: void};

export const OwnerError = {
  /**
   * `accept_ownership` with no offer open.
   */
  100: {message:"NoPendingOffer"},
  /**
   * The offer's ledger has passed: on `accept_ownership`, or on
   * `transfer_ownership` with a `live_until_ledger` already behind.
   */
  101: {message:"OfferExpired"},
  /**
   * Ownership offered to the current owner.
   */
  102: {message:"SameOwner"}
}


/**
 * An offer of ownership, open until `live_until_ledger` inclusive.
 */
export interface PendingOwner {
  live_until_ledger: u32;
  owner: string;
}












export interface Client {
  /**
   * Construct and simulate a fund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The client escrows the budget: one authorization covers this call and
   * the token `transfer` into the kernel. No approve step.
   */
  fund: ({client, job_id, expected_budget}: {client: string, job_id: u64, expected_budget: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a skim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner only. Pays `to` whatever the kernel holds above the escrowed and
   * withdrawable totals: tokens sent to it outside `fund`.
   */
  skim: ({to}: {to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  owner: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a reject transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The client closes the job: at any time while Open or Funded, and
   * inside the challenge window once Submitted. An escrowed budget is
   * credited back to the client in full.
   */
  reject: ({client, job_id, reason}: {client: string, job_id: u64, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The provider records the deliverable's hash before `expired_at`. The
   * challenge window starts now.
   */
  submit: ({provider, job_id, deliverable}: {provider: string, job_id: u64, deliverable: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_job: ({job_id}: {job_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Job>>>

  /**
   * Construct and simulate a finalize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone, once the challenge window has passed without a rejection:
   * credits the provider the budget less the fee, and the owner the fee.
   */
  finalize: ({job_id}: {job_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The client opens a job for `provider`, to be funded before and
   * delivered by `expired_at`. Returns the job id, counted from 1.
   */
  create_job: ({client, provider, expired_at, description}: {client: string, provider: string, expired_at: u64, description: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a set_budget transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Either party sets the budget while the job is Open. `fund` then names
   * the budget it expects, so neither party can change it underneath the
   * other.
   */
  set_budget: ({caller, job_id, amount}: {caller: string, job_id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a ttl_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  ttl_config: (options?: MethodOptions) => Promise<AssembledTransaction<TtlConfig>>

  /**
   * Construct and simulate a job_counter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The id of the last job created; zero before the first.
   */
  job_counter: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a unaccounted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The token balance above the two totals; what `skim` would move.
   */
  unaccounted: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a withdraw_to transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `account` pays `amount` of its balance out to `to`. A `G…` recipient
   * must be able to receive the token (for a classic asset, hold a
   * trustline); the native XLM contract needs none.
   */
  withdraw_to: ({account, to, amount}: {account: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone, once a Funded job has passed `expired_at` without a
   * submission: credits the budget back to the client. A submission stops
   * this clock; a Submitted job resolves only by `reject` or `finalize`.
   */
  claim_refund: ({job_id}: {job_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdrawable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What `account` may `withdraw_to`.
   */
  withdrawable: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a set_ttl_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner only. Corrects the stored network values the TTL rules convert
   * with (`square_common::ttl`).
   */
  set_ttl_config: ({ledger_close_ms, min_persistent_ttl}: {ledger_close_ms: u32, min_persistent_ttl: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_escrowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The sum of the budgets of Funded and Submitted jobs.
   */
  total_escrowed: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a accept_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The offered owner takes ownership while the offer is open.
   */
  accept_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_withdrawable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The sum of every `withdrawable` balance.
   */
  total_withdrawable: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner only. Offers ownership to `new_owner` until `live_until_ledger`.
   */
  transfer_ownership: ({new_owner, live_until_ledger}: {new_owner: string, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {owner, token, challenge_window, platform_fee_bps, ledger_close_ms, min_persistent_ttl}: {owner: string, token: string, challenge_window: u64, platform_fee_bps: u32, ledger_close_ms: u32, min_persistent_ttl: u32},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({owner, token, challenge_window, platform_fee_bps, ledger_close_ms, min_persistent_ttl}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAIlTdG9yYWdlIGtleXMuIGBKb2JgIGFuZCBgV2l0aGRyYXdhYmxlYCBhcmUgcGVyc2lzdGVudCwgdGhlIHJlc3QgaW5zdGFuY2UuCmBPd25lcmAgYW5kIGBQZW5kaW5nT3duZXJgIGFyZSB0YWtlbiBieSBgc3F1YXJlX2NvbW1vbjo6b3duZXJgLgAAAAAAAAAAAAAHRGF0YUtleQAAAAAHAAAAAAAAAAAAAAAGQ29uZmlnAAAAAAAAAAAAAAAAAANUdGwAAAAAAAAAAAAAAAAKSm9iQ291bnRlcgAAAAAAAAAAAAAAAAANVG90YWxFc2Nyb3dlZAAAAAAAAAAAAAAAAAAAEVRvdGFsV2l0aGRyYXdhYmxlAAAAAAAAAQAAAAAAAAADSm9iAAAAAAEAAAAGAAAAAQAAAAAAAAAMV2l0aGRyYXdhYmxlAAAAAQAAABM=",
        "AAAAAAAAAHxUaGUgY2xpZW50IGVzY3Jvd3MgdGhlIGJ1ZGdldDogb25lIGF1dGhvcml6YXRpb24gY292ZXJzIHRoaXMgY2FsbCBhbmQKdGhlIHRva2VuIGB0cmFuc2ZlcmAgaW50byB0aGUga2VybmVsLiBObyBhcHByb3ZlIHN0ZXAuAAAABGZ1bmQAAAADAAAAAAAAAAZjbGllbnQAAAAAABMAAAAAAAAABmpvYl9pZAAAAAAABgAAAAAAAAAPZXhwZWN0ZWRfYnVkZ2V0AAAAAAsAAAABAAAD6QAAAAIAAAfQAAAADlNxdWFyZUpvYkVycm9yAAA=",
        "AAAAAAAAAH1Pd25lciBvbmx5LiBQYXlzIGB0b2Agd2hhdGV2ZXIgdGhlIGtlcm5lbCBob2xkcyBhYm92ZSB0aGUgZXNjcm93ZWQgYW5kCndpdGhkcmF3YWJsZSB0b3RhbHM6IHRva2VucyBzZW50IHRvIGl0IG91dHNpZGUgYGZ1bmRgLgAAAAAAAARza2ltAAAAAQAAAAAAAAACdG8AAAAAABMAAAABAAAD6QAAAAIAAAfQAAAADlNxdWFyZUpvYkVycm9yAAA=",
        "AAAAAAAAAAAAAAAFb3duZXIAAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAGQ29uZmlnAAA=",
        "AAAAAAAAAKdUaGUgY2xpZW50IGNsb3NlcyB0aGUgam9iOiBhdCBhbnkgdGltZSB3aGlsZSBPcGVuIG9yIEZ1bmRlZCwgYW5kCmluc2lkZSB0aGUgY2hhbGxlbmdlIHdpbmRvdyBvbmNlIFN1Ym1pdHRlZC4gQW4gZXNjcm93ZWQgYnVkZ2V0IGlzCmNyZWRpdGVkIGJhY2sgdG8gdGhlIGNsaWVudCBpbiBmdWxsLgAAAAAGcmVqZWN0AAAAAAADAAAAAAAAAAZjbGllbnQAAAAAABMAAAAAAAAABmpvYl9pZAAAAAAABgAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAA5TcXVhcmVKb2JFcnJvcgAA",
        "AAAAAAAAAGFUaGUgcHJvdmlkZXIgcmVjb3JkcyB0aGUgZGVsaXZlcmFibGUncyBoYXNoIGJlZm9yZSBgZXhwaXJlZF9hdGAuIFRoZQpjaGFsbGVuZ2Ugd2luZG93IHN0YXJ0cyBub3cuAAAAAAAABnN1Ym1pdAAAAAAAAwAAAAAAAAAIcHJvdmlkZXIAAAATAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAAAAAAAC2RlbGl2ZXJhYmxlAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA5TcXVhcmVKb2JFcnJvcgAA",
        "AAAAAAAAAAAAAAAHZ2V0X2pvYgAAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAD6QAAB9AAAAADSm9iAAAAB9AAAAAOU3F1YXJlSm9iRXJyb3IAAA==",
        "AAAAAAAAAIZBbnlvbmUsIG9uY2UgdGhlIGNoYWxsZW5nZSB3aW5kb3cgaGFzIHBhc3NlZCB3aXRob3V0IGEgcmVqZWN0aW9uOgpjcmVkaXRzIHRoZSBwcm92aWRlciB0aGUgYnVkZ2V0IGxlc3MgdGhlIGZlZSwgYW5kIHRoZSBvd25lciB0aGUgZmVlLgAAAAAACGZpbmFsaXplAAAAAQAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAQAAA+kAAAACAAAH0AAAAA5TcXVhcmVKb2JFcnJvcgAA",
        "AAAAAAAAAH1UaGUgY2xpZW50IG9wZW5zIGEgam9iIGZvciBgcHJvdmlkZXJgLCB0byBiZSBmdW5kZWQgYmVmb3JlIGFuZApkZWxpdmVyZWQgYnkgYGV4cGlyZWRfYXRgLiBSZXR1cm5zIHRoZSBqb2IgaWQsIGNvdW50ZWQgZnJvbSAxLgAAAAAAAApjcmVhdGVfam9iAAAAAAAEAAAAAAAAAAZjbGllbnQAAAAAABMAAAAAAAAACHByb3ZpZGVyAAAAEwAAAAAAAAAKZXhwaXJlZF9hdAAAAAAABgAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAEAAAPpAAAABgAAB9AAAAAOU3F1YXJlSm9iRXJyb3IAAA==",
        "AAAAAAAAAJFFaXRoZXIgcGFydHkgc2V0cyB0aGUgYnVkZ2V0IHdoaWxlIHRoZSBqb2IgaXMgT3Blbi4gYGZ1bmRgIHRoZW4gbmFtZXMKdGhlIGJ1ZGdldCBpdCBleHBlY3RzLCBzbyBuZWl0aGVyIHBhcnR5IGNhbiBjaGFuZ2UgaXQgdW5kZXJuZWF0aCB0aGUKb3RoZXIuAAAAAAAACnNldF9idWRnZXQAAAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGam9iX2lkAAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAADlNxdWFyZUpvYkVycm9yAAA=",
        "AAAAAAAAAAAAAAAKdHRsX2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAACVR0bENvbmZpZwAAAA==",
        "AAAAAAAAADZUaGUgaWQgb2YgdGhlIGxhc3Qgam9iIGNyZWF0ZWQ7IHplcm8gYmVmb3JlIHRoZSBmaXJzdC4AAAAAAAtqb2JfY291bnRlcgAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAD9UaGUgdG9rZW4gYmFsYW5jZSBhYm92ZSB0aGUgdHdvIHRvdGFsczsgd2hhdCBgc2tpbWAgd291bGQgbW92ZS4AAAAAC3VuYWNjb3VudGVkAAAAAAAAAAABAAAACw==",
        "AAAAAAAAALVgYWNjb3VudGAgcGF5cyBgYW1vdW50YCBvZiBpdHMgYmFsYW5jZSBvdXQgdG8gYHRvYC4gQSBgR+KApmAgcmVjaXBpZW50Cm11c3QgYmUgYWJsZSB0byByZWNlaXZlIHRoZSB0b2tlbiAoZm9yIGEgY2xhc3NpYyBhc3NldCwgaG9sZCBhCnRydXN0bGluZSk7IHRoZSBuYXRpdmUgWExNIGNvbnRyYWN0IG5lZWRzIG5vbmUuAAAAAAAAC3dpdGhkcmF3X3RvAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAAOU3F1YXJlSm9iRXJyb3IAAA==",
        "AAAAAAAAAMZBbnlvbmUsIG9uY2UgYSBGdW5kZWQgam9iIGhhcyBwYXNzZWQgYGV4cGlyZWRfYXRgIHdpdGhvdXQgYQpzdWJtaXNzaW9uOiBjcmVkaXRzIHRoZSBidWRnZXQgYmFjayB0byB0aGUgY2xpZW50LiBBIHN1Ym1pc3Npb24gc3RvcHMKdGhpcyBjbG9jazsgYSBTdWJtaXR0ZWQgam9iIHJlc29sdmVzIG9ubHkgYnkgYHJlamVjdGAgb3IgYGZpbmFsaXplYC4AAAAAAAxjbGFpbV9yZWZ1bmQAAAABAAAAAAAAAAZqb2JfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAADlNxdWFyZUpvYkVycm9yAAA=",
        "AAAAAAAAACFXaGF0IGBhY2NvdW50YCBtYXkgYHdpdGhkcmF3X3RvYC4AAAAAAAAMd2l0aGRyYXdhYmxlAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAY=",
        "AAAAAAAAAVpEZXBsb3lzIHdpdGggaXRzIHNldHRpbmdzLiBgb3duZXJgIHJlY2VpdmVzIHRoZSBmZWVzIGFuZCBtYXkgYHNraW1gLApgc2V0X3R0bF9jb25maWdgIGFuZCBvZmZlciBvd25lcnNoaXA7IGB0b2tlbmAgaXMgdGhlIFNFUC00MSBjb250cmFjdApqb2JzIGFyZSBwYWlkIGluOyBgY2hhbGxlbmdlX3dpbmRvd2AgaXMgaW4gc2Vjb25kcyBhbmQgbWF5IGJlIHplcm8KKGluc3RhbnQgZmluYWxpemUsIG5vIHJlamVjdGlvbiBvZiBhIHN1Ym1pc3Npb24pOyBgbGVkZ2VyX2Nsb3NlX21zYAphbmQgYG1pbl9wZXJzaXN0ZW50X3R0bGAgYXJlIHRoZSBuZXR3b3JrJ3MgdmFsdWVzCihgc3F1YXJlX2NvbW1vbjo6dHRsYCkuAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAYAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAABBjaGFsbGVuZ2Vfd2luZG93AAAABgAAAAAAAAAQcGxhdGZvcm1fZmVlX2JwcwAAAAQAAAAAAAAAD2xlZGdlcl9jbG9zZV9tcwAAAAAEAAAAAAAAABJtaW5fcGVyc2lzdGVudF90dGwAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADlNxdWFyZUpvYkVycm9yAAA=",
        "AAAAAAAAAGFPd25lciBvbmx5LiBDb3JyZWN0cyB0aGUgc3RvcmVkIG5ldHdvcmsgdmFsdWVzIHRoZSBUVEwgcnVsZXMgY29udmVydAp3aXRoIChgc3F1YXJlX2NvbW1vbjo6dHRsYCkuAAAAAAAADnNldF90dGxfY29uZmlnAAAAAAACAAAAAAAAAA9sZWRnZXJfY2xvc2VfbXMAAAAABAAAAAAAAAASbWluX3BlcnNpc3RlbnRfdHRsAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAAA5TcXVhcmVKb2JFcnJvcgAA",
        "AAAAAAAAADRUaGUgc3VtIG9mIHRoZSBidWRnZXRzIG9mIEZ1bmRlZCBhbmQgU3VibWl0dGVkIGpvYnMuAAAADnRvdGFsX2VzY3Jvd2VkAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAADpUaGUgb2ZmZXJlZCBvd25lciB0YWtlcyBvd25lcnNoaXAgd2hpbGUgdGhlIG9mZmVyIGlzIG9wZW4uAAAAAAAQYWNjZXB0X293bmVyc2hpcAAAAAAAAAABAAAD6QAAAAIAAAfQAAAACk93bmVyRXJyb3IAAA==",
        "AAAAAAAAAChUaGUgc3VtIG9mIGV2ZXJ5IGB3aXRoZHJhd2FibGVgIGJhbGFuY2UuAAAAEnRvdGFsX3dpdGhkcmF3YWJsZQAAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAEZPd25lciBvbmx5LiBPZmZlcnMgb3duZXJzaGlwIHRvIGBuZXdfb3duZXJgIHVudGlsIGBsaXZlX3VudGlsX2xlZGdlcmAuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAACk93bmVyRXJyb3IAAA==",
        "AAAAAQAAAEdBIGpvYi4gVGltZXN0YW1wcyBhcmUgbGVkZ2VyIHNlY29uZHM7IGEgemVybyB0aW1lc3RhbXAgbWVhbnMgIm5vdCB5ZXQiLgAAAAAAAAAAA0pvYgAAAAAMAAAALEVzY3Jvd2VkIG9uIGBmdW5kYDsgemVybyB1bnRpbCBgc2V0X2J1ZGdldGAuAAAABmJ1ZGdldAAAAAAABgAAADpUaGUgZGVwbG95bWVudCdzIGNoYWxsZW5nZSB3aW5kb3cgYXQgY3JlYXRpb24sIGluIHNlY29uZHMuAAAAAAAQY2hhbGxlbmdlX3dpbmRvdwAAAAYAAAAAAAAABmNsaWVudAAAAAAAEwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAACBUaGUgaGFzaCB0aGUgcHJvdmlkZXIgc3VibWl0dGVkLgAAAAtkZWxpdmVyYWJsZQAAAAPoAAAD7gAAACAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAABAQWZ0ZXIgdGhpcywgYGZ1bmRgIGFuZCBgc3VibWl0YCByZWZ1c2UgYW5kIGBjbGFpbV9yZWZ1bmRgIG9wZW5zLgAAAApleHBpcmVkX2F0AAAAAAAGAAAAAAAAAAlmdW5kZWRfYXQAAAAAAAAGAAAAYFRoZSBkZXBsb3ltZW50J3MgZmVlIGF0IGNyZWF0aW9uLiBTZXR0aW5ncyBkbyBub3QgY2hhbmdlLCBzbyB0aGlzIGlzCnRoZSBmZWUgYGZpbmFsaXplYCBjaGFyZ2VzLgAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAAAAAAAIcHJvdmlkZXIAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAJSm9iU3RhdHVzAAAAAAAAR2BmaW5hbGl6ZWAgb3BlbnMgYXQgYHN1Ym1pdHRlZF9hdCArIGNoYWxsZW5nZV93aW5kb3dgOyBgcmVqZWN0YCBjbG9zZXMuAAAAAAxzdWJtaXR0ZWRfYXQAAAAG",
        "AAAAAQAAADRUaGUgZGVwbG95bWVudCdzIHNldHRpbmdzLCBmaXhlZCBieSB0aGUgY29uc3RydWN0b3IuAAAAAAAAAAZDb25maWcAAAAAAAMAAAA0U2Vjb25kcyB0aGUgY2xpZW50IGhhcyBhZnRlciBhIHN1Ym1pc3Npb24gdG8gcmVqZWN0LgAAABBjaGFsbGVuZ2Vfd2luZG93AAAABgAAADZUaGUgc2hhcmUgb2YgYSBmaW5hbGl6ZWQgYnVkZ2V0IGNyZWRpdGVkIHRvIHRoZSBvd25lci4AAAAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAFhUaGUgU0VQLTQxIHRva2VuIGV2ZXJ5IGpvYiBpcyBwYWlkIGluOiBvbiB0ZXN0bmV0IHRoZSBuYXRpdmUgWExNClN0ZWxsYXIgQXNzZXQgQ29udHJhY3QuAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAwAAADNUaGUgc3RhdHVzIG9mIGEgam9iLCBpbiB0aGUgb3JkZXIgdGhlIEVWTSBlbnVtIGhhZC4AAAAAAAAAAAlKb2JTdGF0dXMAAAAAAAAGAAAAOkNyZWF0ZWQ7IHRoZSBidWRnZXQgbWF5IHN0aWxsIGNoYW5nZTsgbm90aGluZyBpcyBlc2Nyb3dlZC4AAAAAAARPcGVuAAAAAAAAABxUaGUgYnVkZ2V0IGlzIGluIHRoZSBrZXJuZWwuAAAABkZ1bmRlZAAAAAAAAQAAAEZUaGUgcHJvdmlkZXIgZGVsaXZlcmVkOyB0aGUgY2hhbGxlbmdlIHdpbmRvdyBydW5zIGZyb20gYHN1Ym1pdHRlZF9hdGAuAAAAAAAJU3VibWl0dGVkAAAAAAAAAgAAAERGaW5hbGl6ZWQgYWZ0ZXIgdGhlIHdpbmRvdzogdGhlIHByb3ZpZGVyIHdhcyBjcmVkaXRlZCwgbGVzcyB0aGUgZmVlLgAAAAlDb21wbGV0ZWQAAAAAAAADAAAAQFRoZSBjbGllbnQgcmVqZWN0ZWQ6IHRoZSBidWRnZXQsIGlmIGVzY3Jvd2VkLCB3YXMgY3JlZGl0ZWQgYmFjay4AAAAIUmVqZWN0ZWQAAAAEAAAAOEV4cGlyZWQgYmVmb3JlIHN1Ym1pc3Npb246IHRoZSBidWRnZXQgd2FzIGNyZWRpdGVkIGJhY2suAAAAB0V4cGlyZWQAAAAABQ==",
        "AAAABAAAAKFUaGUga2VybmVsJ3MgZXJyb3IgY29kZXMuIE51bWJlcnMgYXJlIHN0YWJsZTogdGhlIFNESyBtYXBzIGEgc2ltdWxhdGlvbidzCmBFcnJvcihDb250cmFjdCwgI24pYCB0byB0aGVzZSBuYW1lcy4gMTAw4oCTMTAyIGJlbG9uZyB0bwpbYGNyYXRlOjpvd25lcjo6T3duZXJFcnJvcmBdLgAAAAAAAAAAAAAOU3F1YXJlSm9iRXJyb3IAAAAAABMAAAATTm8gam9iIGhhcyB0aGlzIGlkLgAAAAAKSW52YWxpZEpvYgAAAAAAAQAAADJUaGUgam9iIGlzIG5vdCBpbiBhIHN0YXR1cyB0aGlzIGFjdGlvbiBhcHBsaWVzIHRvLgAAAAAAC1dyb25nU3RhdHVzAAAAAAIAAAAjVGhlIHNpZ25lciBpcyBub3QgdGhlIGpvYidzIGNsaWVudC4AAAAACU5vdENsaWVudAAAAAAAAAMAAAAlVGhlIHNpZ25lciBpcyBub3QgdGhlIGpvYidzIHByb3ZpZGVyLgAAAAAAAAtOb3RQcm92aWRlcgAAAAAEAAAAOFRoZSBzaWduZXIgaXMgbmVpdGhlciB0aGUgam9iJ3MgY2xpZW50IG5vciBpdHMgcHJvdmlkZXIuAAAACE5vdFBhcnR5AAAABQAAAClDbGllbnQgYW5kIHByb3ZpZGVyIGFyZSB0aGUgc2FtZSBhZGRyZXNzLgAAAAAAAAlTYW1lUGFydHkAAAAAAAAGAAAALGBleHBpcmVkX2F0YCBpcyBub3QgYWZ0ZXIgdGhlIGxlZGdlcidzIHRpbWUuAAAADkV4cGlyeVRvb1Nob3J0AAAAAAAHAAAANUEgZGVzY3JpcHRpb24gb3IgcmVhc29uIGxvbmdlciB0aGFuIGBNQVhfVEVYVGAgYnl0ZXMuAAAAAAAAC1RleHRUb29Mb25nAAAAAAgAAAA1QW4gYW1vdW50IHRoYXQgaXMgbm90IHBvc2l0aXZlIG9yIGRvZXMgbm90IGZpdCBgdTY0YC4AAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAkAAAAbYGZ1bmRgIGJlZm9yZSBgc2V0X2J1ZGdldGAuAAAAAApaZXJvQnVkZ2V0AAAAAAAKAAAAM2BmdW5kYCdzIGBleHBlY3RlZF9idWRnZXRgIGlzIG5vdCB0aGUgam9iJ3MgYnVkZ2V0LgAAAAAOQnVkZ2V0TWlzbWF0Y2gAAAAAAAsAAAAsYGZ1bmRgIG9yIGBzdWJtaXRgIGF0IG9yIGFmdGVyIGBleHBpcmVkX2F0YC4AAAAHRXhwaXJlZAAAAAAMAAAAI2BjbGFpbV9yZWZ1bmRgIGJlZm9yZSBgZXhwaXJlZF9hdGAuAAAAAApOb3RFeHBpcmVkAAAAAAANAAAAMmBmaW5hbGl6ZWAgYmVmb3JlIHRoZSBjaGFsbGVuZ2Ugd2luZG93IGhhcyBwYXNzZWQuAAAAAAAKV2luZG93T3BlbgAAAAAADgAAAD9gcmVqZWN0YCBvZiBhIHN1Ym1pc3Npb24gYWZ0ZXIgdGhlIGNoYWxsZW5nZSB3aW5kb3cgaGFzIHBhc3NlZC4AAAAADFdpbmRvd0Nsb3NlZAAAAA8AAAAxYHdpdGhkcmF3X3RvYCBvZiBtb3JlIHRoYW4gdGhlIGFjY291bnQncyBiYWxhbmNlLgAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAABAAAAA1YHNraW1gIHdoZW4gdGhlIHRva2VuIGJhbGFuY2UgaXMgZnVsbHkgYWNjb3VudGVkIGZvci4AAAAAAAANTm90aGluZ1RvU2tpbQAAAAAAABEAAAAvQSBjb25zdHJ1Y3RvciBmZWUgYWJvdmUgYE1BWF9QTEFURk9STV9GRUVfQlBTYC4AAAAACkZlZVRvb0hpZ2gAAAAAABIAAAAgQSBgVHRsQ29uZmlnYCB3aXRoIGEgemVybyBmaWVsZC4AAAAQSW52YWxpZFR0bENvbmZpZwAAABM=",
        "AAAAAQAAADJUaGUgdHdvIG5ldHdvcmsgdmFsdWVzIHRoZSBUVEwgcnVsZXMgY29udmVydCB3aXRoLgAAAAAAAAAAAAlUdGxDb25maWcAAAAAAAACAAAAQWBsZWRnZXJUYXJnZXRDbG9zZVRpbWVNaWxsaXNlY29uZHNgOyA1LDAwMCBvbiB0ZXN0bmV0IGFuZCBwdWJuZXQuAAAAAAAAD2xlZGdlcl9jbG9zZV9tcwAAAAAEAAAAQmBtaW5QZXJzaXN0ZW50VHRsYCwgaW4gbGVkZ2VyczsgMTIwLDk2MCBvbiB0ZXN0bmV0IChhYm91dCA3IGRheXMpLgAAAAAAEm1pbl9wZXJzaXN0ZW50X3R0bAAAAAAABA==",
        "AAAAAgAAAHNJbnN0YW5jZS1zdG9yYWdlIGtleXMuIEEgY29udHJhY3QncyBvd24gYERhdGFLZXlgIG11c3Qgbm90IHJldXNlIHRoZXNlCnZhcmlhbnQgbmFtZXMgKHNlZSB0aGUgY3JhdGUgZG9jdW1lbnRhdGlvbikuAAAAAAAAAAAIT3duZXJLZXkAAAACAAAAAAAAAAAAAAAFT3duZXIAAAAAAAAAAAAAAAAAAAxQZW5kaW5nT3duZXI=",
        "AAAABAAAAAAAAAAAAAAACk93bmVyRXJyb3IAAAAAAAMAAAAmYGFjY2VwdF9vd25lcnNoaXBgIHdpdGggbm8gb2ZmZXIgb3Blbi4AAAAAAA5Ob1BlbmRpbmdPZmZlcgAAAAAAZAAAAHtUaGUgb2ZmZXIncyBsZWRnZXIgaGFzIHBhc3NlZDogb24gYGFjY2VwdF9vd25lcnNoaXBgLCBvciBvbgpgdHJhbnNmZXJfb3duZXJzaGlwYCB3aXRoIGEgYGxpdmVfdW50aWxfbGVkZ2VyYCBhbHJlYWR5IGJlaGluZC4AAAAADE9mZmVyRXhwaXJlZAAAAGUAAAAnT3duZXJzaGlwIG9mZmVyZWQgdG8gdGhlIGN1cnJlbnQgb3duZXIuAAAAAAlTYW1lT3duZXIAAAAAAABm",
        "AAAAAQAAAEBBbiBvZmZlciBvZiBvd25lcnNoaXAsIG9wZW4gdW50aWwgYGxpdmVfdW50aWxfbGVkZ2VyYCBpbmNsdXNpdmUuAAAAAAAAAAxQZW5kaW5nT3duZXIAAAACAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAABW93bmVyAAAAAAAAEw==",
        "AAAABQAAAAAAAAAAAAAAEE93bmVyc2hpcE9mZmVyZWQAAAABAAAAEW93bmVyc2hpcF9vZmZlcmVkAAAAAAAAAwAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFE93bmVyc2hpcFRyYW5zZmVycmVkAAAAAQAAABVvd25lcnNoaXBfdHJhbnNmZXJyZWQAAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAI=",
        "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" ]),
      options
    )
  }
  public readonly fromJSON = {
    fund: this.txFromJSON<Result<void>>,
        skim: this.txFromJSON<Result<void>>,
        owner: this.txFromJSON<string>,
        config: this.txFromJSON<Config>,
        reject: this.txFromJSON<Result<void>>,
        submit: this.txFromJSON<Result<void>>,
        get_job: this.txFromJSON<Result<Job>>,
        finalize: this.txFromJSON<Result<void>>,
        create_job: this.txFromJSON<Result<u64>>,
        set_budget: this.txFromJSON<Result<void>>,
        ttl_config: this.txFromJSON<TtlConfig>,
        job_counter: this.txFromJSON<u64>,
        unaccounted: this.txFromJSON<i128>,
        withdraw_to: this.txFromJSON<Result<void>>,
        claim_refund: this.txFromJSON<Result<void>>,
        withdrawable: this.txFromJSON<u64>,
        set_ttl_config: this.txFromJSON<Result<void>>,
        total_escrowed: this.txFromJSON<u64>,
        accept_ownership: this.txFromJSON<Result<void>>,
        total_withdrawable: this.txFromJSON<u64>,
        transfer_ownership: this.txFromJSON<Result<void>>
  }
}