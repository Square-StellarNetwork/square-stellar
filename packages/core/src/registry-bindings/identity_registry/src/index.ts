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




export const IdentityError = {
  1: {message:"NotOwnerOrApproved"},
  2: {message:"UriNotSet"},
  3: {message:"AgentNotFound"},
  4: {message:"MetadataKeyTooLong"},
  5: {message:"MetadataValueTooLong"},
  6: {message:"TooManyMetadataKeys"},
  7: {message:"ReservedMetadataKey"},
  8: {message:"EmptyValue"},
  9: {message:"NoUpgradeProposed"},
  10: {message:"TimelockNotExpired"},
  11: {message:"UpgradeAlreadyProposed"}
}





export interface UpgradeProposal {
  proposed_at: u32;
  wasm_hash: Buffer;
}


export interface MetadataEntry {
  key: string;
  value: Buffer;
}








export interface Client {
  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a register_with_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_with_uri: ({caller, agent_uri}: {caller: string, agent_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a register_full transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_full: ({caller, agent_uri, metadata}: {caller: string, agent_uri: string, metadata: Array<MetadataEntry>}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a set_agent_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_agent_uri: ({caller, agent_id, new_uri}: {caller: string, agent_id: u32, new_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a agent_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_uri: ({agent_id}: {agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_metadata: ({caller, agent_id, key, value}: {caller: string, agent_id: u32, key: string, value: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Routes `agentWallet` key to the dedicated wallet storage slot.
   */
  get_metadata: ({agent_id, key}: {agent_id: u32, key: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_agent_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_agent_wallet: ({caller, agent_id, new_wallet}: {caller: string, agent_id: u32, new_wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_agent_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_agent_wallet: ({agent_id}: {agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a unset_agent_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unset_agent_wallet: ({caller, agent_id}: {caller: string, agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: ({agent_id}: {agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
   * Construct and simulate a find_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Non-panicking `owner_of` (safe for cross-contract calls).
   */
  find_owner: ({agent_id}: {agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a agent_exists transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_exists: ({agent_id}: {agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a is_authorized_or_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true if spender is owner or approved. False if agent missing.
   */
  is_authorized_or_owner: ({spender, agent_id}: {spender: string, agent_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a total_agents transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_agents: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of tokens owned by `account`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `account` - The address for which the balance is being queried.
   */
  balance: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a owner_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the owner of the token with `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  owner_of: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers the token with `token_id` from `from` to `to`.
   * 
   * WARNING: Confirmation that the recipient is capable of receiving the
   * `Non-Fungible` is the caller's responsibility; otherwise the NFT may be
   * permanently lost.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `from` - Account of the sender.
   * * `to` - Account of the recipient.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::IncorrectOwner`] - If the current owner
   * (before calling this function) is not `from`.
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   * 
   * # Events
   * 
   * * topics - `["transfer", from: Address, to: Address]`
   * * data - `[token_id: u32]`
   */
  transfer: ({from, to, token_id}: {from: string, to: string, token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers the token with `token_id` from `from` to `to` by using
   * `spender`s approval.
   * 
   * Unlike `transfer()`, which is used when the token owner initiates the
   * transfer, `transfer_from()` allows an approved third party
   * (`spender`) to transfer the token on behalf of the owner. This
   * function verifies that `spender` has the necessary approval.
   * 
   * WARNING: Confirmation that the recipient is capable of receiving the
   * `Non-Fungible` is the caller's responsibility; otherwise the NFT may be
   * permanently lost.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `spender` - The address authorizing the transfer.
   * * `from` - Account of the sender.
   * * `to` - Account of the recipient.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::IncorrectOwner`] - If the current owner
   * (before calling this function) is not `from`.
   * * [`NonFungibleTokenError::InsufficientApproval`] - If the spender does
   * not have a valid approval.
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   * 
   * # Events
   */
  transfer_from: ({spender, from, to, token_id}: {spender: string, from: string, to: string, token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Gives permission to `approved` to transfer the token with `token_id` to
   * another account. The approval is cleared when the token is
   * transferred.
   * 
   * Only a single account can be approved at a time for a `token_id`.
   * To remove an approval, the approver can approve their own address,
   * effectively removing the previous approved address. Alternatively,
   * setting the `live_until_ledger` to `0` will also revoke the approval.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `approver` - The address of the approver (should be `owner` or
   * `operator`).
   * * `approved` - The address receiving the approval.
   * * `token_id` - Token ID as a number.
   * * `live_until_ledger` - The ledger number at which the allowance
   * expires. If `live_until_ledger` is `0`, the approval is revoked.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   * * [`NonFungibleTokenError::InvalidApprover`] - If the owner address is
   * not the actual owner of the token.
   * * [`NonFungibleTokenError::InvalidLiveUntilLedger`] - If the ledge
   */
  approve: ({approver, approved, token_id, live_until_ledger}: {approver: string, approved: string, token_id: u32, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_for_all transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve or remove `operator` as an operator for the owner.
   * 
   * Operators can call `transfer_from()` for any token held by `owner`,
   * and call `approve()` on behalf of `owner`.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `owner` - The address holding the tokens.
   * * `operator` - Account to add to the set of authorized operators.
   * * `live_until_ledger` - The ledger number at which the allowance
   * expires. If `live_until_ledger` is `0`, the approval is revoked.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::InvalidLiveUntilLedger`] - If the ledger
   * number is less than the current ledger number.
   * 
   * # Events
   * 
   * * topics - `["approve_for_all", from: Address]`
   * * data - `[operator: Address, live_until_ledger: u32]`
   */
  approve_for_all: ({owner, operator, live_until_ledger}: {owner: string, operator: string, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the account approved for the token with `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  get_approved: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a is_approved_for_all transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether the `operator` is allowed to manage all the assets of
   * `owner`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `owner` - Account of the token's owner.
   * * `operator` - Account to be checked.
   */
  is_approved_for_all: ({owner, operator}: {owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token collection name.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token collection symbol.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a token_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the Uniform Resource Identifier (URI) for the token with
   * `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Notes
   * 
   * If the token does not exist, this function is expected to panic.
   */
  token_uri: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

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
        {owner, name, symbol}: {owner: string, name: string, symbol: string},
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
    return ContractClient.deploy({owner, name, symbol}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAA=",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAABA==",
        "AAAAAAAAAAAAAAARcmVnaXN0ZXJfd2l0aF91cmkAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACWFnZW50X3VyaQAAAAAAABAAAAABAAAABA==",
        "AAAAAAAAAAAAAAANcmVnaXN0ZXJfZnVsbAAAAAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAJYWdlbnRfdXJpAAAAAAAAEAAAAAAAAAAIbWV0YWRhdGEAAAPqAAAH0AAAAA1NZXRhZGF0YUVudHJ5AAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAANc2V0X2FnZW50X3VyaQAAAAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAAAAAAduZXdfdXJpAAAAABAAAAABAAAD6QAAAAIAAAfQAAAADUlkZW50aXR5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAJYWdlbnRfdXJpAAAAAAAAAQAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAQAAA+kAAAAQAAAH0AAAAA1JZGVudGl0eUVycm9yAAAA",
        "AAAAAAAAAAAAAAAMc2V0X21ldGFkYXRhAAAABAAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAhhZ2VudF9pZAAAAAQAAAAAAAAAA2tleQAAAAAQAAAAAAAAAAV2YWx1ZQAAAAAAAA4AAAABAAAD6QAAAAIAAAfQAAAADUlkZW50aXR5RXJyb3IAAAA=",
        "AAAAAAAAAD5Sb3V0ZXMgYGFnZW50V2FsbGV0YCBrZXkgdG8gdGhlIGRlZGljYXRlZCB3YWxsZXQgc3RvcmFnZSBzbG90LgAAAAAADGdldF9tZXRhZGF0YQAAAAIAAAAAAAAACGFnZW50X2lkAAAABAAAAAAAAAADa2V5AAAAABAAAAABAAAD6AAAAA4=",
        "AAAAAAAAAAAAAAAQc2V0X2FnZW50X3dhbGxldAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAAAAAApuZXdfd2FsbGV0AAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA1JZGVudGl0eUVycm9yAAAA",
        "AAAAAAAAAAAAAAAQZ2V0X2FnZW50X3dhbGxldAAAAAEAAAAAAAAACGFnZW50X2lkAAAABAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAASdW5zZXRfYWdlbnRfd2FsbGV0AAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACGFnZW50X2lkAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANSWRlbnRpdHlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAANSWRlbnRpdHlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUlkZW50aXR5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADUlkZW50aXR5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAPcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAPVXBncmFkZVByb3Bvc2FsAA==",
        "AAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAAAAAAAQAAABA=",
        "AAAAAAAAADlOb24tcGFuaWNraW5nIGBvd25lcl9vZmAgKHNhZmUgZm9yIGNyb3NzLWNvbnRyYWN0IGNhbGxzKS4AAAAAAAAKZmluZF9vd25lcgAAAAAAAQAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAAMYWdlbnRfZXhpc3RzAAAAAQAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAQAAAAE=",
        "AAAAAAAAAEVSZXR1cm5zIHRydWUgaWYgc3BlbmRlciBpcyBvd25lciBvciBhcHByb3ZlZC4gRmFsc2UgaWYgYWdlbnQgbWlzc2luZy4AAAAAAAAWaXNfYXV0aG9yaXplZF9vcl9vd25lcgAAAAAAAgAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAhhZ2VudF9pZAAAAAQAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAMdG90YWxfYWdlbnRzAAAAAAAAAAEAAAAE",
        "AAAAAAAAAKtSZXR1cm5zIHRoZSBudW1iZXIgb2YgdG9rZW5zIG93bmVkIGJ5IGBhY2NvdW50YC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdGhlIGJhbGFuY2UgaXMgYmVpbmcgcXVlcmllZC4AAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAQ=",
        "AAAAAAAAAOVSZXR1cm5zIHRoZSBvd25lciBvZiB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAACG93bmVyX29mAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAABM=",
        "AAAAAAAAAqBUcmFuc2ZlcnMgdGhlIHRva2VuIHdpdGggYHRva2VuX2lkYCBmcm9tIGBmcm9tYCB0byBgdG9gLgoKV0FSTklORzogQ29uZmlybWF0aW9uIHRoYXQgdGhlIHJlY2lwaWVudCBpcyBjYXBhYmxlIG9mIHJlY2VpdmluZyB0aGUKYE5vbi1GdW5naWJsZWAgaXMgdGhlIGNhbGxlcidzIHJlc3BvbnNpYmlsaXR5OyBvdGhlcndpc2UgdGhlIE5GVCBtYXkgYmUKcGVybWFuZW50bHkgbG9zdC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgZnJvbWAgLSBBY2NvdW50IG9mIHRoZSBzZW5kZXIuCiogYHRvYCAtIEFjY291bnQgb2YgdGhlIHJlY2lwaWVudC4KKiBgdG9rZW5faWRgIC0gVG9rZW4gSUQgYXMgYSBudW1iZXIuCgojIEVycm9ycwoKKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6SW5jb3JyZWN0T3duZXJgXSAtIElmIHRoZSBjdXJyZW50IG93bmVyCihiZWZvcmUgY2FsbGluZyB0aGlzIGZ1bmN0aW9uKSBpcyBub3QgYGZyb21gLgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJ0cmFuc2ZlciIsIGZyb206IEFkZHJlc3MsIHRvOiBBZGRyZXNzXWAKKiBkYXRhIC0gYFt0b2tlbl9pZDogdTMyXWAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAA=",
        "AAAAAAAABABUcmFuc2ZlcnMgdGhlIHRva2VuIHdpdGggYHRva2VuX2lkYCBmcm9tIGBmcm9tYCB0byBgdG9gIGJ5IHVzaW5nCmBzcGVuZGVyYHMgYXBwcm92YWwuCgpVbmxpa2UgYHRyYW5zZmVyKClgLCB3aGljaCBpcyB1c2VkIHdoZW4gdGhlIHRva2VuIG93bmVyIGluaXRpYXRlcyB0aGUKdHJhbnNmZXIsIGB0cmFuc2Zlcl9mcm9tKClgIGFsbG93cyBhbiBhcHByb3ZlZCB0aGlyZCBwYXJ0eQooYHNwZW5kZXJgKSB0byB0cmFuc2ZlciB0aGUgdG9rZW4gb24gYmVoYWxmIG9mIHRoZSBvd25lci4gVGhpcwpmdW5jdGlvbiB2ZXJpZmllcyB0aGF0IGBzcGVuZGVyYCBoYXMgdGhlIG5lY2Vzc2FyeSBhcHByb3ZhbC4KCldBUk5JTkc6IENvbmZpcm1hdGlvbiB0aGF0IHRoZSByZWNpcGllbnQgaXMgY2FwYWJsZSBvZiByZWNlaXZpbmcgdGhlCmBOb24tRnVuZ2libGVgIGlzIHRoZSBjYWxsZXIncyByZXNwb25zaWJpbGl0eTsgb3RoZXJ3aXNlIHRoZSBORlQgbWF5IGJlCnBlcm1hbmVudGx5IGxvc3QuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXppbmcgdGhlIHRyYW5zZmVyLgoqIGBmcm9tYCAtIEFjY291bnQgb2YgdGhlIHNlbmRlci4KKiBgdG9gIC0gQWNjb3VudCBvZiB0aGUgcmVjaXBpZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpJbmNvcnJlY3RPd25lcmBdIC0gSWYgdGhlIGN1cnJlbnQgb3duZXIKKGJlZm9yZSBjYWxsaW5nIHRoaXMgZnVuY3Rpb24pIGlzIG5vdCBgZnJvbWAuCiogW2BOb25GdW5naWJsZVRva2VuRXJyb3I6Okluc3VmZmljaWVudEFwcHJvdmFsYF0gLSBJZiB0aGUgc3BlbmRlciBkb2VzCm5vdCBoYXZlIGEgdmFsaWQgYXBwcm92YWwuCiogW2BOb25GdW5naWJsZVRva2VuRXJyb3I6Ok5vbkV4aXN0ZW50VG9rZW5gXSAtIElmIHRoZSB0b2tlbiBkb2VzIG5vdApleGlzdC4KCiMgRXZlbnRzAAAADXRyYW5zZmVyX2Zyb20AAAAAAAAEAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAA==",
        "AAAAAAAABABHaXZlcyBwZXJtaXNzaW9uIHRvIGBhcHByb3ZlZGAgdG8gdHJhbnNmZXIgdGhlIHRva2VuIHdpdGggYHRva2VuX2lkYCB0bwphbm90aGVyIGFjY291bnQuIFRoZSBhcHByb3ZhbCBpcyBjbGVhcmVkIHdoZW4gdGhlIHRva2VuIGlzCnRyYW5zZmVycmVkLgoKT25seSBhIHNpbmdsZSBhY2NvdW50IGNhbiBiZSBhcHByb3ZlZCBhdCBhIHRpbWUgZm9yIGEgYHRva2VuX2lkYC4KVG8gcmVtb3ZlIGFuIGFwcHJvdmFsLCB0aGUgYXBwcm92ZXIgY2FuIGFwcHJvdmUgdGhlaXIgb3duIGFkZHJlc3MsCmVmZmVjdGl2ZWx5IHJlbW92aW5nIHRoZSBwcmV2aW91cyBhcHByb3ZlZCBhZGRyZXNzLiBBbHRlcm5hdGl2ZWx5LApzZXR0aW5nIHRoZSBgbGl2ZV91bnRpbF9sZWRnZXJgIHRvIGAwYCB3aWxsIGFsc28gcmV2b2tlIHRoZSBhcHByb3ZhbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBhcHByb3ZlcmAgLSBUaGUgYWRkcmVzcyBvZiB0aGUgYXBwcm92ZXIgKHNob3VsZCBiZSBgb3duZXJgIG9yCmBvcGVyYXRvcmApLgoqIGBhcHByb3ZlZGAgLSBUaGUgYWRkcmVzcyByZWNlaXZpbmcgdGhlIGFwcHJvdmFsLgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KKiBgbGl2ZV91bnRpbF9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgYXQgd2hpY2ggdGhlIGFsbG93YW5jZQpleHBpcmVzLiBJZiBgbGl2ZV91bnRpbF9sZWRnZXJgIGlzIGAwYCwgdGhlIGFwcHJvdmFsIGlzIHJldm9rZWQuCgojIEVycm9ycwoKKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6Tm9uRXhpc3RlbnRUb2tlbmBdIC0gSWYgdGhlIHRva2VuIGRvZXMgbm90CmV4aXN0LgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpJbnZhbGlkQXBwcm92ZXJgXSAtIElmIHRoZSBvd25lciBhZGRyZXNzIGlzCm5vdCB0aGUgYWN0dWFsIG93bmVyIG9mIHRoZSB0b2tlbi4KKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gSWYgdGhlIGxlZGdlAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAAAAAAhhcHByb3ZlZAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAA==",
        "AAAAAAAAAr9BcHByb3ZlIG9yIHJlbW92ZSBgb3BlcmF0b3JgIGFzIGFuIG9wZXJhdG9yIGZvciB0aGUgb3duZXIuCgpPcGVyYXRvcnMgY2FuIGNhbGwgYHRyYW5zZmVyX2Zyb20oKWAgZm9yIGFueSB0b2tlbiBoZWxkIGJ5IGBvd25lcmAsCmFuZCBjYWxsIGBhcHByb3ZlKClgIG9uIGJlaGFsZiBvZiBgb3duZXJgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYG93bmVyYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIHRva2Vucy4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBhZGQgdG8gdGhlIHNldCBvZiBhdXRob3JpemVkIG9wZXJhdG9ycy4KKiBgbGl2ZV91bnRpbF9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgYXQgd2hpY2ggdGhlIGFsbG93YW5jZQpleHBpcmVzLiBJZiBgbGl2ZV91bnRpbF9sZWRnZXJgIGlzIGAwYCwgdGhlIGFwcHJvdmFsIGlzIHJldm9rZWQuCgojIEVycm9ycwoKKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gSWYgdGhlIGxlZGdlcgpudW1iZXIgaXMgbGVzcyB0aGFuIHRoZSBjdXJyZW50IGxlZGdlciBudW1iZXIuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJhcHByb3ZlX2Zvcl9hbGwiLCBmcm9tOiBBZGRyZXNzXWAKKiBkYXRhIC0gYFtvcGVyYXRvcjogQWRkcmVzcywgbGl2ZV91bnRpbF9sZWRnZXI6IHUzMl1gAAAAAA9hcHByb3ZlX2Zvcl9hbGwAAAAAAwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAA=",
        "AAAAAAAAAPFSZXR1cm5zIHRoZSBhY2NvdW50IGFwcHJvdmVkIGZvciB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAADGdldF9hcHByb3ZlZAAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAANdSZXR1cm5zIHdoZXRoZXIgdGhlIGBvcGVyYXRvcmAgaXMgYWxsb3dlZCB0byBtYW5hZ2UgYWxsIHRoZSBhc3NldHMgb2YKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gQWNjb3VudCBvZiB0aGUgdG9rZW4ncyBvd25lci4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBiZSBjaGVja2VkLgAAAAATaXNfYXBwcm92ZWRfZm9yX2FsbAAAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAB",
        "AAAAAAAAAFtSZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIG5hbWUuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAARuYW1lAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAF1SZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIHN5bWJvbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAPVSZXR1cm5zIHRoZSBVbmlmb3JtIFJlc291cmNlIElkZW50aWZpZXIgKFVSSSkgZm9yIHRoZSB0b2tlbiB3aXRoCmB0b2tlbl9pZGAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHRva2VuX2lkYCAtIFRva2VuIElEIGFzIGEgbnVtYmVyLgoKIyBOb3RlcwoKSWYgdGhlIHRva2VuIGRvZXMgbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIGlzIGV4cGVjdGVkIHRvIHBhbmljLgAAAAAAAAl0b2tlbl91cmkAAAAAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAABAAAAEA==",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAABAAAAAAAAAAAAAAADUlkZW50aXR5RXJyb3IAAAAAAAALAAAAAAAAABJOb3RPd25lck9yQXBwcm92ZWQAAAAAAAEAAAAAAAAACVVyaU5vdFNldAAAAAAAAAIAAAAAAAAADUFnZW50Tm90Rm91bmQAAAAAAAADAAAAAAAAABJNZXRhZGF0YUtleVRvb0xvbmcAAAAAAAQAAAAAAAAAFE1ldGFkYXRhVmFsdWVUb29Mb25nAAAABQAAAAAAAAATVG9vTWFueU1ldGFkYXRhS2V5cwAAAAAGAAAAAAAAABNSZXNlcnZlZE1ldGFkYXRhS2V5AAAAAAcAAAAAAAAACkVtcHR5VmFsdWUAAAAAAAgAAAAAAAAAEU5vVXBncmFkZVByb3Bvc2VkAAAAAAAACQAAAAAAAAASVGltZWxvY2tOb3RFeHBpcmVkAAAAAAAKAAAAAAAAABZVcGdyYWRlQWxyZWFkeVByb3Bvc2VkAAAAAAAL",
        "AAAABQAAAAAAAAAAAAAAClJlZ2lzdGVyZWQAAAAAAAEAAAAKcmVnaXN0ZXJlZAAAAAAAAwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAJYWdlbnRfdXJpAAAAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAClVyaVVwZGF0ZWQAAAAAAAEAAAALdXJpX3VwZGF0ZWQAAAAAAwAAAAAAAAAIYWdlbnRfaWQAAAAEAAAAAQAAAAAAAAAKdXBkYXRlZF9ieQAAAAAAEwAAAAEAAAAAAAAAB25ld191cmkAAAAAEAAAAAAAAAAC",
        "AAAABQAAAERBbGwgbWV0YWRhdGEgd3JpdGVzIChpbmNsdWRpbmcgYWdlbnRXYWxsZXQpIGZsb3cgdGhyb3VnaCB0aGlzIGV2ZW50LgAAAAAAAAALTWV0YWRhdGFTZXQAAAAAAQAAAAxtZXRhZGF0YV9zZXQAAAADAAAAAAAAAAhhZ2VudF9pZAAAAAQAAAABAAAAAAAAAANrZXkAAAAAEAAAAAEAAAAAAAAABXZhbHVlAAAAAAAADgAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NhbAAAAAACAAAAAAAAAAtwcm9wb3NlZF9hdAAAAAAEAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAADU1ldGFkYXRhRW50cnkAAAAAAAACAAAAAAAAAANrZXkAAAAAEAAAAAAAAAAFdmFsdWUAAAAAAAAO",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyB0cmFuc2ZlcnJlZC4AAAAAAAAAAAAIVHJhbnNmZXIAAAABAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAAAAAAC",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gYW4gYXBwcm92YWwgaXMgZ3JhbnRlZC4AAAAAAAAAAAAHQXBwcm92ZQAAAAABAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAAAAAAAAIYXBwcm92ZWQAAAATAAAAAAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYXBwcm92YWwgZm9yIGFsbCB0b2tlbnMgaXMgZ3JhbnRlZC4AAAAAAAAAAAANQXBwcm92ZUZvckFsbAAAAAAAAAEAAAAPYXBwcm92ZV9mb3JfYWxsAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAAAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyBtaW50ZWQuAAAAAAAAAAAAAARNaW50AAAAAQAAAARtaW50AAAAAgAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAAAg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    register: this.txFromJSON<u32>,
        register_with_uri: this.txFromJSON<u32>,
        register_full: this.txFromJSON<u32>,
        set_agent_uri: this.txFromJSON<Result<void>>,
        agent_uri: this.txFromJSON<Result<string>>,
        set_metadata: this.txFromJSON<Result<void>>,
        get_metadata: this.txFromJSON<Option<Buffer>>,
        set_agent_wallet: this.txFromJSON<Result<void>>,
        get_agent_wallet: this.txFromJSON<Option<string>>,
        unset_agent_wallet: this.txFromJSON<Result<void>>,
        extend_ttl: this.txFromJSON<null>,
        propose_upgrade: this.txFromJSON<Result<void>>,
        cancel_upgrade: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        pending_upgrade: this.txFromJSON<Option<UpgradeProposal>>,
        version: this.txFromJSON<string>,
        find_owner: this.txFromJSON<Option<string>>,
        agent_exists: this.txFromJSON<boolean>,
        is_authorized_or_owner: this.txFromJSON<boolean>,
        total_agents: this.txFromJSON<u32>,
        balance: this.txFromJSON<u32>,
        owner_of: this.txFromJSON<string>,
        transfer: this.txFromJSON<null>,
        transfer_from: this.txFromJSON<null>,
        approve: this.txFromJSON<null>,
        approve_for_all: this.txFromJSON<null>,
        get_approved: this.txFromJSON<Option<string>>,
        is_approved_for_all: this.txFromJSON<boolean>,
        name: this.txFromJSON<string>,
        symbol: this.txFromJSON<string>,
        token_uri: this.txFromJSON<string>,
        get_owner: this.txFromJSON<Option<string>>,
        transfer_ownership: this.txFromJSON<null>,
        accept_ownership: this.txFromJSON<null>,
        renounce_ownership: this.txFromJSON<null>
  }
}