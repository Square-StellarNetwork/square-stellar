import { Asset, BASE_FEE, Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, type ClientOptions } from "@stellar/stellar-sdk/contract";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { addressKind } from "./address.js";
import { contractIdOf, contractsOf, type SquareContractName, type SquareDeployment } from "./deployments.js";
import {
  ArchivedStateError,
  decodeContractError,
  decodeDiagnostics,
  DeploymentNetworkMismatchError,
  NeedsMoreSignaturesError,
  SAC_ERRORS,
  simulationError,
  TransactionFailedError,
  TransactionPendingError,
  TransactionSendError,
  TrustlineMissingError,
  type ContractErrorContext,
  type ContractErrorTable,
} from "./errors.js";
import { decodeSquareEvents, type SquareEvent } from "./events.js";
import { networks, type StellarNetworkProfile } from "./network.js";
import { WalletRequiredError, type Signer } from "./signer.js";

/** The contracts a call can name: one the deployment names, the payment token, or any id. */
export type ContractRef = SquareContractName | "usdc" | { id: string; name?: string };

export interface ContractCall<T = unknown> {
  contract: ContractRef;
  method: string;
  /** Already as `ScVal`s: the bindings' `Spec.funcArgsToScVals`, or `nativeToScVal` with a type. */
  args?: readonly xdr.ScVal[];
  /** The return value from its `ScVal`; `scValToNative` when omitted. */
  parse?: (value: xdr.ScVal) => T;
}

/**
 * What a write hands back once the transaction is in a ledger: the hash, the
 * ledger, the contract's return value, the deployment's events it emitted,
 * and the fee actually charged in stroops (the inclusion fee plus the
 * resource fee, refunds applied).
 */
export interface TransactionResult<T = unknown> {
  hash: string;
  ledger: number;
  result: T;
  events: SquareEvent[];
  feeCharged: bigint;
  response: Api.GetSuccessfulTransactionResponse;
}

/** Where a `G…` account stands with the USDC trustline it needs to hold or receive USDC. */
export type UsdcTrustline =
  /** A contract: it needs no trustline (auth-and-token-flow.md, "Trustlines"). */
  | { status: "contract" }
  /** An account without one: a transfer to it fails with the SAC's `TrustlineMissingError`. */
  | { status: "missing" }
  | { status: "open"; balance: bigint; limit: bigint; authorized: boolean };

export interface SquareClientConfig {
  deployment: SquareDeployment;
  /**
   * The RPC endpoint, or a ready `rpc.Server` (one with failover from
   * `@squaresdk/hardening`, or a test double). The network profile's endpoint
   * when omitted; pubnet has none, so there it is required.
   */
  rpc?: string | Server | undefined;
  /** Needed for writes; a client without one reads. */
  signer?: Signer | undefined;
  /** Inclusion fee per operation in stroops; the network's base fee (100) when omitted. */
  fee?: string | undefined;
  /**
   * How long a sent transaction is waited for, and how long it stays valid
   * (its time bound), in seconds. A ledger closes about every five seconds;
   * the default leaves room for a busy network.
   */
  timeoutInSeconds?: number | undefined;
  /** Whether an `http://` endpoint is accepted. Default: only for a local network. */
  allowHttp?: boolean | undefined;
  /**
   * Error tables beyond the payment token's: each contract's `Errors` from
   * its generated bindings, so a simulation failure is named. Filled in as
   * the bindings gain their methods (#8 onwards).
   */
  errorTables?: Partial<Record<SquareContractName, ContractErrorTable>> | undefined;
}

const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * The client over the Square contracts on Stellar. Every write is simulated
 * first; a refusal is thrown with the contract's own error decoded and
 * nothing is sent. A write that passes simulation is signed, sent and polled
 * until it is in a ledger, and answered with what it returned and emitted.
 *
 * The methods per contract (`createJob`, `fund`, `submit`, …) arrive with the
 * contracts' interfaces (#9 onwards) on top of `read` and `write` here; the
 * payment-token methods are already on, since the SAC's interface is fixed.
 */
export class SquareClient {
  readonly deployment: SquareDeployment;
  readonly network: StellarNetworkProfile | undefined;
  readonly server: Server;
  readonly rpcUrl: string;
  readonly signer: Signer | undefined;
  readonly fee: string;
  readonly timeoutInSeconds: number;
  private readonly allowHttp: boolean;
  private readonly names: ReadonlyMap<string, SquareContractName | "usdc">;
  private readonly errorTables: Partial<Record<SquareContractName | "usdc", ContractErrorTable>>;

  constructor(config: SquareClientConfig) {
    this.deployment = config.deployment;
    this.network = networks[config.deployment.network];
    const rpc = config.rpc ?? this.network?.rpcUrl;
    if (rpc === undefined) throw new Error(`pass rpc: ${config.deployment.network} has no default endpoint`);
    this.allowHttp = config.allowHttp ?? config.deployment.network === "stellar:local";
    if (typeof rpc === "string") {
      this.rpcUrl = rpc;
      this.server = new Server(rpc, { allowHttp: this.allowHttp });
    } else {
      this.server = rpc;
      this.rpcUrl = rpc.serverURL.toString();
    }
    this.signer = config.signer;
    if (this.signer?.networkPassphrase !== undefined && this.signer.networkPassphrase !== this.deployment.networkPassphrase) {
      throw new DeploymentNetworkMismatchError(this.deployment.networkPassphrase, this.signer.networkPassphrase, "declared");
    }
    this.fee = config.fee ?? BASE_FEE;
    this.timeoutInSeconds = config.timeoutInSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.names = contractsOf(this.deployment);
    this.errorTables = { usdc: SAC_ERRORS, ...config.errorTables };
  }

  /** The signer's address; `WalletRequiredError` on a read-only client. */
  get account(): string {
    return this.requireSigner().address;
  }

  private requireSigner(): Signer {
    if (!this.signer) throw new WalletRequiredError();
    return this.signer;
  }

  private endpointNetwork: Promise<void> | undefined;

  /**
   * Ask the endpoint which network it is, once, and refuse to go on if it is
   * not the deployment's. The deployment record and the profile agree by
   * construction; only the endpoint's own answer can catch an RPC URL that
   * points at some other network, where every read would answer from the
   * wrong ledger at the deployment's ids. Runs before the first read or
   * write; a transport failure is not cached, so the next call retries it.
   */
  async assertNetwork(): Promise<void> {
    this.endpointNetwork ??= this.server.getNetwork().then((network) => {
      if (network.passphrase !== this.deployment.networkPassphrase) {
        throw new DeploymentNetworkMismatchError(this.deployment.networkPassphrase, network.passphrase, "endpoint");
      }
    });
    try {
      await this.endpointNetwork;
    } catch (error) {
      this.endpointNetwork = undefined;
      throw error;
    }
  }

  /**
   * The latest ledger the endpoint has, from `getHealth`: `getLatestLedger`
   * answers with the whole ledger's close meta as well, which is a lot of
   * bytes for a sequence number.
   */
  async latestLedger(): Promise<number> {
    await this.assertNetwork();
    return (await this.server.getHealth()).latestLedger;
  }

  /** The id and name a call's contract resolves to. */
  resolve(contract: ContractRef): { id: string; name: string } {
    if (typeof contract === "string") {
      const id = contractIdOf(this.deployment, contract);
      if (id === undefined) throw new Error(`the deployment names no ${contract}`);
      return { id, name: contract };
    }
    return { id: contract.id, name: contract.name ?? this.names.get(contract.id) ?? contract.id };
  }

  private get errorContext(): ContractErrorContext {
    return {
      nameOf: (contractId) => this.names.get(contractId),
      tableOf: (name) => this.errorTables[name as SquareContractName | "usdc"],
    };
  }

  /**
   * The options a bindings `Client` for one of the deployment's contracts
   * takes: the same endpoint, network, signer and error table this client
   * uses, so a transaction it assembles goes through `send` here.
   */
  clientOptions(contract: ContractRef): ClientOptions {
    const { id, name } = this.resolve(contract);
    const table = this.errorTables[name as SquareContractName | "usdc"];
    return {
      contractId: id,
      networkPassphrase: this.deployment.networkPassphrase,
      rpcUrl: this.rpcUrl,
      server: this.server,
      allowHttp: this.allowHttp,
      ...(this.signer ? { publicKey: this.signer.address, signTransaction: this.signer, signAuthEntry: this.signer } : {}),
      ...(table ? { errorTypes: Object.fromEntries(Object.entries(table).map(([code, message]) => [Number(code), { message }])) } : {}),
    };
  }

  private async assemble<T>(call: ContractCall<T>, signer: Signer | undefined): Promise<AssembledTransaction<T>> {
    await this.assertNetwork();
    const { id, name } = this.resolve(call.contract);
    const parse = call.parse ?? ((value: xdr.ScVal) => scValToNative(value) as T);
    const tx = await AssembledTransaction.build<T>({
      contractId: id,
      method: call.method,
      args: [...(call.args ?? [])],
      parseResultXdr: parse,
      networkPassphrase: this.deployment.networkPassphrase,
      rpcUrl: this.rpcUrl,
      server: this.server,
      allowHttp: this.allowHttp,
      fee: this.fee,
      timeoutInSeconds: this.timeoutInSeconds,
      simulate: true,
      // A write pays to restore archived entries it needs; a read cannot (fees-and-ttl.md).
      restore: signer !== undefined,
      ...(signer ? { publicKey: signer.address, signTransaction: signer, signAuthEntry: signer } : {}),
    });
    const simulation = tx.simulation;
    if (!simulation) throw new Error(`${name}.${call.method} was not simulated`);
    if (Api.isSimulationError(simulation)) {
      throw simulationError(name, call.method, simulation.error, decodeDiagnostics(simulation.events), this.errorContext);
    }
    if (Api.isSimulationRestore(simulation)) throw new ArchivedStateError(name, call.method);
    return tx;
  }

  /** Simulate a call and answer its return value. Nothing is signed or sent. */
  async read<T = unknown>(call: ContractCall<T>): Promise<T> {
    const tx = await this.assemble(call, undefined);
    return tx.result;
  }

  /** Simulate, sign, send and wait for a call. Needs a signer. */
  async write<T = unknown>(call: ContractCall<T>): Promise<TransactionResult<T>> {
    const signer = this.requireSigner();
    const tx = await this.assemble(call, signer);
    return this.send(tx, call.contract);
  }

  /**
   * The rest of a write for a transaction assembled elsewhere: by a bindings
   * `Client` built from `clientOptions`, or by `read`'s simulation that turned
   * out to be a write. Signs the authorization entries the signer owns, then
   * the envelope, sends, and polls until the network answers.
   */
  async send<T>(tx: AssembledTransaction<T>, contract: ContractRef): Promise<TransactionResult<T>> {
    const signer = this.requireSigner();
    const { name } = this.resolve(contract);
    const method = tx.options.method;
    const needed = tx.needsNonInvokerSigningBy();
    if (needed.includes(signer.address)) {
      await tx.signAuthEntries({ signAuthEntry: signer, address: signer.address });
    }
    const others = tx.needsNonInvokerSigningBy().filter((address) => !address.startsWith("C"));
    if (others.length > 0) throw new NeedsMoreSignaturesError(name, method, others);
    // `force`: a call the simulation found to write nothing is still the
    // caller's to send, and sending it is how that is learnt for certain.
    await tx.sign({ force: true, signTransaction: signer });
    const signed = tx.signed;
    if (!signed) throw new Error(`${name}.${method} was not signed`);
    const sent = await this.server.sendTransaction(signed);
    if (sent.status !== "PENDING") {
      throw new TransactionSendError(sent.status, sent.hash, sent.errorResult?.toXDR("base64"), decodeDiagnostics(sent.diagnosticEvents));
    }
    const response = await this.waitFor(sent.hash);
    return this.settle(response, tx.options.parseResultXdr);
  }

  private async waitFor(hash: string): Promise<Api.GetSuccessfulTransactionResponse | Api.GetFailedTransactionResponse> {
    const deadline = Date.now() + this.timeoutInSeconds * 1000;
    let delay = 1000;
    for (;;) {
      const response = await this.server.getTransaction(hash);
      if (response.status !== Api.GetTransactionStatus.NOT_FOUND) return response;
      if (Date.now() >= deadline) throw new TransactionPendingError(hash, this.timeoutInSeconds);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
      delay = Math.min(delay * 1.5, 5000);
    }
  }

  private settle<T>(response: Api.GetSuccessfulTransactionResponse | Api.GetFailedTransactionResponse, parse: (value: xdr.ScVal) => T): TransactionResult<T> {
    const diagnostics = decodeDiagnostics(response.diagnosticEventsXdr);
    if (response.status === Api.GetTransactionStatus.FAILED) {
      const resultXdr = response.resultXdr.toXDR("base64");
      throw new TransactionFailedError(response.txHash, response.ledger, resultXdr, diagnostics, decodeContractError(resultXdr, diagnostics, this.errorContext));
    }
    return {
      hash: response.txHash,
      ledger: response.ledger,
      result: parse(response.returnValue ?? xdr.ScVal.scvVoid()),
      events: decodeSquareEvents(response, this.deployment),
      feeCharged: BigInt(response.resultXdr.feeCharged().toString()),
      response,
    };
  }

  /**
   * A transaction by hash, as `write` would have answered it: null while the
   * network has not seen it (or no longer holds it: the RPC keeps about
   * seven days), `TransactionFailedError` when it failed.
   */
  async getTransaction(hash: string): Promise<TransactionResult | null> {
    await this.assertNetwork();
    const response = await this.server.getTransaction(hash);
    if (response.status === Api.GetTransactionStatus.NOT_FOUND) return null;
    return this.settle(response, (value) => scValToNative(value) as unknown);
  }

  /** The deployment's events in a transaction or a `getEvents` page. */
  decodeEvents(source: Parameters<typeof decodeSquareEvents>[0]): SquareEvent[] {
    return decodeSquareEvents(source, this.deployment);
  }

  // ---- USDC -----------------------------------------------------------------

  get usdcAsset(): Asset {
    return new Asset(this.deployment.usdc.code, this.deployment.usdc.issuer);
  }

  private trustlineKey(account: string): xdr.LedgerKey {
    return xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({ accountId: Keypair.fromPublicKey(account).xdrAccountId(), asset: this.usdcAsset.toTrustLineXDRObject() }),
    );
  }

  /**
   * Where an address stands with USDC, read from the ledger without a
   * simulation: a contract needs no trustline; an account needs one before it
   * can hold or receive USDC, and a missing one is what every USDC transfer
   * to it would fail on.
   */
  async usdcTrustline(address: string): Promise<UsdcTrustline> {
    await this.assertNetwork();
    if (addressKind(address) === "contract") return { status: "contract" };
    const { entries } = await this.server.getLedgerEntries(this.trustlineKey(address));
    const entry = entries[0];
    if (!entry || entry.val.switch() !== xdr.LedgerEntryType.trustline()) return { status: "missing" };
    const line = entry.val.trustLine();
    return {
      status: "open",
      balance: BigInt(line.balance().toString()),
      limit: BigInt(line.limit().toString()),
      authorized: (line.flags() & 1) === 1,
    };
  }

  async hasUsdcTrustline(address: string): Promise<boolean> {
    return (await this.usdcTrustline(address)).status !== "missing";
  }

  /** Throws `TrustlineMissingError` for an account that could not be paid in USDC. */
  async assertUsdcReceivable(address: string): Promise<void> {
    if ((await this.usdcTrustline(address)).status === "missing") {
      throw new TrustlineMissingError(address, `${this.deployment.usdc.code}:${this.deployment.usdc.issuer}`);
    }
  }

  /**
   * USDC held, in base units: the trustline's balance for an account, the
   * SAC's balance entry for a contract. Zero for an account with no
   * trustline, which `usdcTrustline` tells apart from an empty one.
   */
  async usdcBalance(address: string): Promise<bigint> {
    await this.assertNetwork();
    if (addressKind(address) === "contract") {
      const { balanceEntry } = await this.server.getSACBalance(address, this.usdcAsset, this.deployment.networkPassphrase);
      return balanceEntry ? BigInt(balanceEntry.amount) : 0n;
    }
    const line = await this.usdcTrustline(address);
    return line.status === "open" ? line.balance : 0n;
  }

  /**
   * Open the signer's USDC trustline, through the SAC's own `trust`
   * (CAP-0073): one simulated, signed invocation under the account's
   * authorization, rather than a classic operation. Null for a signer that
   * is a contract, which needs none. The account needs the reserve a
   * trustline takes, half an XLM (auth-and-token-flow.md, "Account reserves").
   */
  async trustUsdc(): Promise<TransactionResult<void> | null> {
    const signer = this.requireSigner();
    if (addressKind(signer.address) === "contract") return null;
    return this.write<void>({
      contract: "usdc",
      method: "trust",
      args: [nativeToScVal(signer.address, { type: "address" })],
      parse: () => undefined,
    });
  }
}

export function createSquareClient(config: SquareClientConfig): SquareClient {
  return new SquareClient(config);
}

/**
 * `createSquareClient`, then the endpoint check, before the client is handed
 * back. The check runs on first use either way; this is for a caller that
 * wants a misconfigured RPC URL to fail at startup rather than on the first
 * request it serves.
 */
export async function connectSquareClient(config: SquareClientConfig): Promise<SquareClient> {
  const client = new SquareClient(config);
  await client.assertNetwork();
  return client;
}
