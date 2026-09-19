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




export const ValidationError = {
  1: {message:"NotOwnerOrApproved"},
  2: {message:"RequestNotFound"},
  3: {message:"InvalidResponse"},
  4: {message:"RequestAlreadyExists"},
  5: {message:"NotDesignatedValidator"},
  /**
   * Retained for ABI stability (now unused).
   */
  6: {message:"AlreadyResponded"},
  7: {message:"AgentNotFound"},
  8: {message:"CounterOverflow"},
  9: {message:"NoUpgradeProposed"},
  10: {message:"TimelockNotExpired"},
  11: {message:"UpgradeAlreadyProposed"}
}




export interface UpgradeProposal {
  proposed_at: u32;
  wasm_hash: Buffer;
}


export interface ValidationStatus {
  agent_id: u32;
  has_response: boolean;
  last_update: u64;
  response: u32;
  response_hash: Buffer;
  tag: string;
  validator_address: string;
}


export interface ValidationSummary {
  average_response: u32;
  count: u64;
}




export interface Client {
  /**
   * Construct and simulate a validation_request transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  validation_request: ({caller, validator_address, agent_id, request_uri, request_hash}: {caller: string, validator_address: string, agent_id: u32, request_uri: string, request_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a validation_response transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Responses are updateable (progressive validation); only original validator can update.
   */
  validation_response: ({caller, request_hash, response, response_uri, response_hash, tag}: {caller: string, request_hash: Buffer, response: u32, response_uri: string, response_hash: Buffer, tag: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_validation_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_validation_status: ({request_hash}: {request_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ValidationStatus>>>

  /**
   * Construct and simulate a request_exists transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  request_exists: ({request_hash}: {request_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_summary transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_summary: ({agent_id, validator_addresses, tag}: {agent_id: u32, validator_addresses: Array<string>, tag: string}, options?: MethodOptions) => Promise<AssembledTransaction<ValidationSummary>>

  /**
   * Construct and simulate a get_agent_validations_paginated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_agent_validations_paginated: ({agent_id, start, limit}: {agent_id: u32, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a get_validator_requests_paginated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_validator_requests_paginated: ({validator_address, start, limit}: {validator_address: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a get_identity_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_identity_registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<UpgradeProposal>>>

  /**
   * Construct and simulate a version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  version: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `Some(Address)` if ownership is set, or `None` if ownership has
   * been renounced.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   */
  get_owner: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initiates a 2-step ownership transfer to a new address.
   * 
   * Requires authorization from the current owner. The new owner must later
   * call `accept_ownership()` to complete the transfer.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `new_owner` - The proposed new owner.
   * * `live_until_ledger` - Ledger number until which the new owner can
   * accept. A value of `0` cancels any pending transfer.
   * 
   * # Errors
   * 
   * * [`OwnableError::OwnerNotSet`] - If the owner is not set.
   * * [`crate::role_transfer::RoleTransferError::NoPendingTransfer`] - If
   * trying to cancel a transfer that doesn't exist.
   * * [`crate::role_transfer::RoleTransferError::InvalidLiveUntilLedger`] -
   * If the specified ledger is in the past.
   * * [`crate::role_transfer::RoleTransferError::InvalidPendingAccount`] -
   * If the specified pending account is not the same as the provided `new`
   * address.
   * 
   * # Notes
   * 
   * * Authorization for the current owner is required.
   */
  transfer_ownership: ({new_owner, live_until_ledger}: {new_owner: string, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accepts a pending ownership transfer.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * 
   * # Errors
   * 
   * * [`crate::role_transfer::RoleTransferError::NoPendingTransfer`] - If
   * there is no pending transfer to accept.
   * 
   * # Events
   * 
   * * topics - `["ownership_transfer_completed"]`
   * * data - `[new_owner: Address]`
   */
  accept_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a renounce_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Renounces ownership of the contract.
   * 
   * Permanently removes the owner, disabling all functions gated by
   * `#[only_owner]`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * 
   * # Errors
   * 
   * * [`OwnableError::TransferInProgress`] - If there is a pending ownership
   * transfer.
   * * [`OwnableError::OwnerNotSet`] - If the owner is not set.
   * 
   * # Notes
   * 
   * * Authorization for the current owner is required.
   */
  renounce_ownership: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {owner, identity_registry}: {owner: string, identity_registry: string},
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
    return ContractClient.deploy({owner, identity_registry}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAARaWRlbnRpdHlfcmVnaXN0cnkAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAASdmFsaWRhdGlvbl9yZXF1ZXN0AAAAAAAFAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAEXZhbGlkYXRvcl9hZGRyZXNzAAAAAAAAEwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAAAAAAtyZXF1ZXN0X3VyaQAAAAAQAAAAAAAAAAxyZXF1ZXN0X2hhc2gAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAAPVmFsaWRhdGlvbkVycm9yAA==",
        "AAAAAAAAAFZSZXNwb25zZXMgYXJlIHVwZGF0ZWFibGUgKHByb2dyZXNzaXZlIHZhbGlkYXRpb24pOyBvbmx5IG9yaWdpbmFsIHZhbGlkYXRvciBjYW4gdXBkYXRlLgAAAAAAE3ZhbGlkYXRpb25fcmVzcG9uc2UAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAxyZXF1ZXN0X2hhc2gAAAPuAAAAIAAAAAAAAAAIcmVzcG9uc2UAAAAEAAAAAAAAAAxyZXNwb25zZV91cmkAAAAQAAAAAAAAAA1yZXNwb25zZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAA3RhZwAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAA9WYWxpZGF0aW9uRXJyb3IA",
        "AAAAAAAAAAAAAAAVZ2V0X3ZhbGlkYXRpb25fc3RhdHVzAAAAAAAAAQAAAAAAAAAMcmVxdWVzdF9oYXNoAAAD7gAAACAAAAABAAAD6QAAB9AAAAAQVmFsaWRhdGlvblN0YXR1cwAAB9AAAAAPVmFsaWRhdGlvbkVycm9yAA==",
        "AAAAAAAAAAAAAAAOcmVxdWVzdF9leGlzdHMAAAAAAAEAAAAAAAAADHJlcXVlc3RfaGFzaAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAALZ2V0X3N1bW1hcnkAAAAAAwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAAAAABN2YWxpZGF0b3JfYWRkcmVzc2VzAAAAA+oAAAATAAAAAAAAAAN0YWcAAAAAEAAAAAEAAAfQAAAAEVZhbGlkYXRpb25TdW1tYXJ5AAAA",
        "AAAAAAAAAAAAAAAfZ2V0X2FnZW50X3ZhbGlkYXRpb25zX3BhZ2luYXRlZAAAAAADAAAAAAAAAAhhZ2VudF9pZAAAAAQAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAgZ2V0X3ZhbGlkYXRvcl9yZXF1ZXN0c19wYWdpbmF0ZWQAAAADAAAAAAAAABF2YWxpZGF0b3JfYWRkcmVzcwAAAAAAABMAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAVZ2V0X2lkZW50aXR5X3JlZ2lzdHJ5AAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAAPVmFsaWRhdGlvbkVycm9yAA==",
        "AAAAAAAAAAAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAD1ZhbGlkYXRpb25FcnJvcgA=",
        "AAAAAAAAAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAD1ZhbGlkYXRpb25FcnJvcgA=",
        "AAAAAAAAAAAAAAAPcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAPVXBncmFkZVByb3Bvc2FsAA==",
        "AAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAABAAAAAAAAAAAAAAAD1ZhbGlkYXRpb25FcnJvcgAAAAALAAAAAAAAABJOb3RPd25lck9yQXBwcm92ZWQAAAAAAAEAAAAAAAAAD1JlcXVlc3ROb3RGb3VuZAAAAAACAAAAAAAAAA9JbnZhbGlkUmVzcG9uc2UAAAAAAwAAAAAAAAAUUmVxdWVzdEFscmVhZHlFeGlzdHMAAAAEAAAAAAAAABZOb3REZXNpZ25hdGVkVmFsaWRhdG9yAAAAAAAFAAAAKFJldGFpbmVkIGZvciBBQkkgc3RhYmlsaXR5IChub3cgdW51c2VkKS4AAAAQQWxyZWFkeVJlc3BvbmRlZAAAAAYAAAAAAAAADUFnZW50Tm90Rm91bmQAAAAAAAAHAAAAAAAAAA9Db3VudGVyT3ZlcmZsb3cAAAAACAAAAAAAAAARTm9VcGdyYWRlUHJvcG9zZWQAAAAAAAAJAAAAAAAAABJUaW1lbG9ja05vdEV4cGlyZWQAAAAAAAoAAAAAAAAAFlVwZ3JhZGVBbHJlYWR5UHJvcG9zZWQAAAAAAAs=",
        "AAAABQAAAAAAAAAAAAAAEVZhbGlkYXRpb25SZXF1ZXN0AAAAAAAAAQAAABJ2YWxpZGF0aW9uX3JlcXVlc3QAAAAAAAQAAAAAAAAAEXZhbGlkYXRvcl9hZGRyZXNzAAAAAAAAEwAAAAEAAAAAAAAACGFnZW50X2lkAAAABAAAAAEAAAAAAAAADHJlcXVlc3RfaGFzaAAAA+4AAAAgAAAAAQAAAAAAAAALcmVxdWVzdF91cmkAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAElZhbGlkYXRpb25SZXNwb25zZQAAAAAAAQAAABN2YWxpZGF0aW9uX3Jlc3BvbnNlAAAAAAcAAAAAAAAAEXZhbGlkYXRvcl9hZGRyZXNzAAAAAAAAEwAAAAEAAAAAAAAACGFnZW50X2lkAAAABAAAAAEAAAAAAAAADHJlcXVlc3RfaGFzaAAAA+4AAAAgAAAAAQAAAAAAAAAIcmVzcG9uc2UAAAAEAAAAAAAAAAAAAAAMcmVzcG9uc2VfdXJpAAAAEAAAAAAAAAAAAAAADXJlc3BvbnNlX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAAAAAAA3RhZwAAAAAQAAAAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NhbAAAAAACAAAAAAAAAAtwcm9wb3NlZF9hdAAAAAAEAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAAEFZhbGlkYXRpb25TdGF0dXMAAAAHAAAAAAAAAAhhZ2VudF9pZAAAAAQAAAAAAAAADGhhc19yZXNwb25zZQAAAAEAAAAAAAAAC2xhc3RfdXBkYXRlAAAAAAYAAAAAAAAACHJlc3BvbnNlAAAABAAAAAAAAAANcmVzcG9uc2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAN0YWcAAAAAEAAAAAAAAAARdmFsaWRhdG9yX2FkZHJlc3MAAAAAAAAT",
        "AAAAAQAAAAAAAAAAAAAAEVZhbGlkYXRpb25TdW1tYXJ5AAAAAAAAAgAAAAAAAAAQYXZlcmFnZV9yZXNwb25zZQAAAAQAAAAAAAAABWNvdW50AAAAAAAABg==",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC" ]),
      options
    )
  }
  public readonly fromJSON = {
    validation_request: this.txFromJSON<Result<void>>,
        validation_response: this.txFromJSON<Result<void>>,
        get_validation_status: this.txFromJSON<Result<ValidationStatus>>,
        request_exists: this.txFromJSON<boolean>,
        get_summary: this.txFromJSON<ValidationSummary>,
        get_agent_validations_paginated: this.txFromJSON<Array<Buffer>>,
        get_validator_requests_paginated: this.txFromJSON<Array<Buffer>>,
        get_identity_registry: this.txFromJSON<string>,
        extend_ttl: this.txFromJSON<null>,
        propose_upgrade: this.txFromJSON<Result<void>>,
        cancel_upgrade: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        pending_upgrade: this.txFromJSON<Option<UpgradeProposal>>,
        version: this.txFromJSON<string>,
        get_owner: this.txFromJSON<Option<string>>,
        transfer_ownership: this.txFromJSON<null>,
        accept_ownership: this.txFromJSON<null>,
        renounce_ownership: this.txFromJSON<null>
  }
}