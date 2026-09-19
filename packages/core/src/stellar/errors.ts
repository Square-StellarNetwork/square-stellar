import { humanizeEvents, type xdr } from "@stellar/stellar-sdk";

/** `#[contracterror]` codes of one contract, by number, as the generated bindings list them. */
export type ContractErrorTable = Readonly<Record<number, string>>;

/**
 * The Stellar Asset Contract's errors, from soroban-env-host 27.0.1
 * (`src/builtin_contracts/contract_error.rs`); code 1 is reserved there. The
 * SAC has no Wasm and so no bindings to read these from. `#13` is the one
 * the SDK acts on: a `G…` account with no USDC trustline
 * (docs/decisions/auth-and-token-flow.md, "Trustlines").
 */
export const SAC_ERRORS: ContractErrorTable = {
  2: "OperationNotSupportedError",
  3: "AlreadyInitializedError",
  4: "UnauthorizedError",
  5: "AuthenticationError",
  6: "AccountMissingError",
  7: "AccountIsNotClassic",
  8: "NegativeAmountError",
  9: "AllowanceError",
  10: "BalanceError",
  11: "BalanceDeauthorizedError",
  12: "OverflowError",
  13: "TrustlineMissingError",
  14: "InsufficientAccountReserve",
  15: "TooManyAccountSubentries",
};

export const SAC_TRUSTLINE_MISSING = 13;

/** A diagnostic event, decoded: what the host logged while simulating or applying. */
export interface Diagnostic {
  contractId: string | undefined;
  topics: unknown[];
  data: unknown;
}

export function decodeDiagnostics(events: readonly xdr.DiagnosticEvent[] | undefined): Diagnostic[] {
  if (!events || events.length === 0) return [];
  return humanizeEvents([...events]).map((event) => ({ contractId: event.contractId, topics: event.topics, data: event.data }));
}

/**
 * A `#[contracterror]` as the host reported it: the contract that raised it,
 * the code, and the message the contract logged with it, when it logged one.
 * `contract` is the crate name when the deployment record names the
 * contract, `usdc` for the payment token, else the contract id.
 */
export interface DecodedContractError {
  contract: string;
  contractId: string | undefined;
  code: number;
  /** The code's name in the contract's error table, when the table has it. */
  errorName: string | undefined;
  detail: string | undefined;
}

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/** The contract error code a host error message names, `HostError: Error(Contract, #13)`. */
export function contractErrorCodeIn(message: string): number | undefined {
  const match = CONTRACT_ERROR.exec(message);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function isContractErrorTopic(value: unknown): value is { type: "contract"; code: number } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "contract" && typeof (value as { code?: unknown }).code === "number";
}

/**
 * The contract errors the diagnostics carry, oldest first. The host logs an
 * `error` event from the frame that raised it and from each frame it
 * propagated through, so the first one is the origin: the hook's error is
 * the first entry when the kernel re-raised it. A contract error the host
 * reports without any diagnostics (a node with diagnostic events off) still
 * has its code in the message, which `contractErrorCodeIn` reads.
 */
export function contractErrorsIn(diagnostics: readonly Diagnostic[]): Array<{ contractId: string | undefined; code: number; detail: string | undefined }> {
  const found: Array<{ contractId: string | undefined; code: number; detail: string | undefined }> = [];
  for (const event of diagnostics) {
    const [topic, error] = event.topics;
    if (topic !== "error" || !isContractErrorTopic(error)) continue;
    const message = Array.isArray(event.data) ? event.data.find((item): item is string => typeof item === "string") : typeof event.data === "string" ? event.data : undefined;
    found.push({ contractId: event.contractId, code: error.code, detail: message });
  }
  return found;
}

export interface ContractErrorContext {
  /** The crate name, or `usdc`, for a contract id the deployment names. */
  nameOf: (contractId: string) => string | undefined;
  /** The error table of a named contract. */
  tableOf: (name: string) => ContractErrorTable | undefined;
}

/**
 * The origin of a failure, decoded: the first contract error in the
 * diagnostics, or the code in the message when the diagnostics carry none;
 * undefined when the failure is not a contract error at all (a host error:
 * budget, auth, a missing entry).
 */
export function decodeContractError(message: string, diagnostics: readonly Diagnostic[], context: ContractErrorContext): DecodedContractError | undefined {
  const origin = contractErrorsIn(diagnostics)[0];
  const code = origin?.code ?? contractErrorCodeIn(message);
  if (code === undefined) return undefined;
  const contractId = origin?.contractId;
  const name = contractId === undefined ? undefined : context.nameOf(contractId);
  const table = name === undefined ? undefined : context.tableOf(name);
  return { contract: name ?? contractId ?? "unknown contract", contractId, code, errorName: table?.[code], detail: origin?.detail };
}

export function describeContractError(error: DecodedContractError): string {
  const name = error.errorName ?? `error #${error.code}`;
  const code = error.errorName ? ` (#${error.code})` : "";
  const detail = error.detail ? `: ${error.detail}` : "";
  return `${error.contract} refused with ${name}${code}${detail}`;
}

/**
 * The simulation refused the call, so nothing was signed or sent. `reason` is
 * the host's message; `diagnostics` is what the host logged, decoded;
 * `contractError` is set when the failure is a `#[contracterror]`, and then
 * the error thrown is the subclass `SquareContractError`.
 */
export class SimulationFailedError extends Error {
  constructor(
    readonly contract: string,
    readonly method: string,
    readonly reason: string,
    readonly diagnostics: readonly Diagnostic[],
    readonly contractError: DecodedContractError | undefined,
    message: string = `${contract}.${method} failed in simulation: ${reason.split("\n")[0]}`,
  ) {
    super(message);
    this.name = "SimulationFailedError";
  }
}

/**
 * The simulation failed with a contract's own error, decoded to its name by
 * the contract's error table, whichever contract in the call tree raised it:
 * `AgentNotOwnedByProvider` from the hook comes back as the hook's, through a
 * `submit` on the kernel.
 */
export class SquareContractError extends SimulationFailedError {
  readonly code: number;
  readonly errorName: string | undefined;
  readonly detail: string | undefined;
  readonly raisedBy: string;

  constructor(contract: string, method: string, reason: string, diagnostics: readonly Diagnostic[], contractError: DecodedContractError) {
    super(contract, method, reason, diagnostics, contractError, `${contract}.${method}: ${describeContractError(contractError)}`);
    this.name = "SquareContractError";
    this.code = contractError.code;
    this.errorName = contractError.errorName;
    this.detail = contractError.detail;
    this.raisedBy = contractError.contract;
  }
}

export function simulationError(contract: string, method: string, reason: string, diagnostics: readonly Diagnostic[], context: ContractErrorContext): SimulationFailedError {
  const decoded = decodeContractError(reason, diagnostics, context);
  return decoded ? new SquareContractError(contract, method, reason, diagnostics, decoded) : new SimulationFailedError(contract, method, reason, diagnostics, undefined);
}

/**
 * The simulation found ledger entries the call needs archived, and this
 * client has no signer to pay for restoring them. A write restores them first
 * on its own (docs/decisions/fees-and-ttl.md); a read cannot.
 */
export class ArchivedStateError extends Error {
  constructor(
    readonly contract: string,
    readonly method: string,
  ) {
    super(`${contract}.${method} needs archived ledger entries restored first, and a read-only client cannot restore them`);
    this.name = "ArchivedStateError";
  }
}

/**
 * The transaction needs authorization from accounts this client does not
 * sign for. Every write function takes the acting address and calls
 * `require_auth` on it (auth-and-token-flow.md, decision 4), so this is a
 * write whose acting address is not the signer's.
 */
export class NeedsMoreSignaturesError extends Error {
  constructor(
    readonly contract: string,
    readonly method: string,
    readonly addresses: readonly string[],
  ) {
    super(`${contract}.${method} needs authorization entries signed by ${addresses.join(", ")}, which this client does not sign for`);
    this.name = "NeedsMoreSignaturesError";
  }
}

/** The network refused the transaction at submission: nothing was included in a ledger. */
export class TransactionSendError extends Error {
  constructor(
    readonly status: string,
    readonly hash: string,
    readonly errorResultXdr: string | undefined,
    readonly diagnostics: readonly Diagnostic[],
  ) {
    super(`the network answered ${status} to transaction ${hash}${errorResultXdr ? ` (${errorResultXdr})` : ""}`);
    this.name = "TransactionSendError";
  }
}

/**
 * The transaction was included in a ledger and failed there, so it changed
 * nothing but the fee. Rare after a clean simulation: the ledger moved
 * between the two, or an entry expired.
 */
export class TransactionFailedError extends Error {
  constructor(
    readonly hash: string,
    readonly ledger: number,
    readonly resultXdr: string,
    readonly diagnostics: readonly Diagnostic[],
    readonly contractError: DecodedContractError | undefined,
  ) {
    super(
      `transaction ${hash} was included in ledger ${ledger} and failed, so it changed nothing` +
        (contractError ? `: ${describeContractError(contractError)}` : ""),
    );
    this.name = "TransactionFailedError";
  }
}

/** Polling gave up before the network answered either way; the hash may still land. */
export class TransactionPendingError extends Error {
  constructor(
    readonly hash: string,
    readonly waitedSeconds: number,
  ) {
    super(`transaction ${hash} was accepted but not seen in a ledger within ${waitedSeconds} s; check it before retrying`);
    this.name = "TransactionPendingError";
  }
}

/**
 * The deployment and the network disagree. `source` says which comparison
 * failed: `"declared"` is the passphrase the caller's signer or profile
 * declares, checked at construction; `"endpoint"` is the passphrase the RPC
 * answered `getNetwork` with, checked before the first read or write. Only
 * the second catches an RPC URL that points at some other network.
 */
export class DeploymentNetworkMismatchError extends Error {
  constructor(
    readonly deploymentPassphrase: string,
    readonly actualPassphrase: string,
    readonly source: "declared" | "endpoint",
  ) {
    super(
      source === "endpoint"
        ? `the deployment is for "${deploymentPassphrase}" but the RPC endpoint answers getNetwork with "${actualPassphrase}"`
        : `the deployment is for "${deploymentPassphrase}" but the client declares "${actualPassphrase}"`,
    );
    this.name = "DeploymentNetworkMismatchError";
  }
}

/**
 * A `G…` account that would receive USDC has no USDC trustline, so the
 * transfer to it would fail with the SAC's `TrustlineMissingError`. The fix
 * is the account's own `trust` call (`SquareClient.trustUsdc`), one signed
 * invocation (auth-and-token-flow.md, decision 3).
 */
export class TrustlineMissingError extends Error {
  constructor(
    readonly account: string,
    readonly asset: string,
  ) {
    super(`${account} has no trustline for ${asset}, so it cannot receive it; open one with trustUsdc()`);
    this.name = "TrustlineMissingError";
  }
}

export class EventNotFoundError extends Error {
  constructor(eventName: string) {
    super(`the transaction succeeded but emitted no ${eventName} event`);
    this.name = "EventNotFoundError";
  }
}
