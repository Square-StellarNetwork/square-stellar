import { Asset, BASE_FEE, Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, Err, Ok, type ClientOptions } from "@stellar/stellar-sdk/contract";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { addressKind, assertStellarAddress } from "./address.js";
import { contractIdOf, contractsOf, type SquareContractName, type SquareDeployment, type TokenName } from "./deployments.js";
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
import { deliverableHash, SQUARE_JOB_ERRORS, squareJobSpec, toKernelConfig, toSquareJob, type JobRecord, type KernelConfig, type KernelConfigRecord, type SquareJob } from "./job.js";
import { assetOf, networks, type StellarNetworkProfile } from "./network.js";
import { WalletRequiredError, type Signer } from "./signer.js";
import { assertTokenAmount } from "./usdc.js";

/** The contracts a call can name: one the deployment names, the payment token (`token`, or `usdc` when the record names USDC), or any id. */
export type ContractRef = SquareContractName | TokenName | { id: string; name?: string };

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

/** Where an address stands with the trustline it needs to hold or receive the payment token. */
export type Trustline =
  /** The token is native XLM: every account holds it, no trustline exists. */
  | { status: "native" }
  /** A contract: it needs no trustline (auth-and-token-flow.md, "Trustlines"). */
  | { status: "contract" }
  /** An account without one: a transfer to it fails with the SAC's `TrustlineMissingError`. */
  | { status: "missing" }
  | { status: "open"; balance: bigint; limit: bigint; authorized: boolean };

/**
 * One position of a `getEvents` topic filter: a value to match, typed the
 * way the contract emitted it, or `"*"` for any. Symbols are event names,
 * addresses `G…`/`C…`, `u64`s job ids.
 */
export type TopicFilter =
  | "*"
  | { symbol: string }
  | { address: string }
  | { u64: bigint | number }
  | { u32: number }
  | { string: string };

export interface EventQuery {
  /** The contract whose events; the kernel when omitted. */
  contract?: ContractRef | undefined;
  /**
   * Topic patterns, each one a list of positions from the first topic (the
   * event's name) on; an event matches when any pattern matches. Omitted:
   * every event of the contract.
   */
  topics?: readonly (readonly TopicFilter[])[] | undefined;
  /** Where to read from: a ledger, or the `cursor` a previous page answered. One of the two. */
  startLedger?: number | undefined;
  cursor?: string | undefined;
  /** At most this many events; the endpoint's own default (100) when omitted. */
  limit?: number | undefined;
}

export interface EventPage {
  events: SquareEvent[];
  /** Pass as `cursor` to read what comes after this page. */
  cursor: string;
  latestLedger: number;
  /** The ledger's clock, unix seconds: what the contracts measure windows and expiries against. */
  latestLedgerCloseTime: bigint;
  /** The endpoint keeps about seven days; a `startLedger` before this is refused. */
  oldestLedger: number;
}

/** What `createJob` takes. */
export interface CreateJobParams {
  /** The provider's address: the agent to be paid. */
  provider: string;
  /** Ledger seconds after which the job can no longer be funded or delivered. */
  expiredAt: bigint | number;
  /** At most 256 bytes. */
  description: string;
}

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
   * Error tables beyond the kernel's and the payment token's: each contract's
   * `Errors` from its generated bindings, so a simulation failure is named.
   * Filled in as the bindings gain their methods.
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
 * The kernel's methods (`createJob`, `fund`, `submit`, `finalize`, …) sit on
 * top of `read` and `write`, encoded through the generated bindings' spec;
 * the other contracts' join as their interfaces land. The payment token's
 * methods read the ledger directly where a simulation would be a detour.
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
  private readonly names: ReadonlyMap<string, SquareContractName | TokenName>;
  private readonly errorTables: Partial<Record<SquareContractName | TokenName, ContractErrorTable>>;

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
    this.errorTables = { token: SAC_ERRORS, usdc: SAC_ERRORS, square_job: SQUARE_JOB_ERRORS, ...config.errorTables };
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
      tableOf: (name) => this.errorTables[name as SquareContractName | TokenName],
    };
  }

  /**
   * The options a bindings `Client` for one of the deployment's contracts
   * takes: the same endpoint, network, signer and error table this client
   * uses, so a transaction it assembles goes through `send` here.
   */
  clientOptions(contract: ContractRef): ClientOptions {
    const { id, name } = this.resolve(contract);
    const table = this.errorTables[name as SquareContractName | TokenName];
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

  /**
   * A page of a contract's events from the endpoint, decoded: how an agent
   * finds the jobs created for it and an app lists jobs without an indexer.
   * Read forward with the page's `cursor`; the page also carries the
   * ledger's clock.
   */
  async getEvents(query: EventQuery = {}): Promise<EventPage> {
    await this.assertNetwork();
    const { id } = this.resolve(query.contract ?? "square_job");
    if ((query.cursor === undefined) === (query.startLedger === undefined)) {
      throw new Error("getEvents takes startLedger or cursor, one of the two");
    }
    const filters: Api.EventFilter[] = [
      {
        type: "contract",
        contractIds: [id],
        ...(query.topics ? { topics: query.topics.map((pattern) => pattern.map(topicScVal)) } : {}),
      },
    ];
    const request: Api.GetEventsRequest =
      query.cursor !== undefined
        ? { filters, cursor: query.cursor, ...(query.limit !== undefined ? { limit: query.limit } : {}) }
        : { filters, startLedger: query.startLedger as number, ...(query.limit !== undefined ? { limit: query.limit } : {}) };
    const page = await this.server.getEvents(request);
    return {
      events: decodeSquareEvents(page, this.deployment),
      cursor: page.cursor,
      latestLedger: page.latestLedger,
      latestLedgerCloseTime: BigInt(page.latestLedgerCloseTime),
      oldestLedger: page.oldestLedger,
    };
  }

  // ---- the kernel ------------------------------------------------------------

  private kernelCall<T>(method: string, args: Record<string, unknown>, parse?: (value: xdr.ScVal) => T): ContractCall<T> {
    return { contract: "square_job", method, args: squareJobSpec.funcArgsToScVals(method, args), ...(parse ? { parse } : {}) };
  }

  /**
   * A read through the spec's own decoding, which knows the return type
   * (`Job`'s option, the enum), and wraps a `Result<T, E>` function's value
   * in `Ok`: a successful simulation is always the `Ok` side, so it is
   * unwrapped here.
   */
  private kernelRead<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.read<T>(
      this.kernelCall(method, args, (value) => {
        const native: unknown = squareJobSpec.funcResToNative(method, value);
        if (native instanceof Ok) return native.unwrap() as T;
        if (native instanceof Err) throw new Error(`square_job.${method} answered an error through a successful simulation: ${String(native.unwrapErr())}`);
        return native as T;
      }),
    );
  }

  private kernelWrite<T = void>(method: string, args: Record<string, unknown>, parse?: (value: xdr.ScVal) => T): Promise<TransactionResult<T>> {
    return this.write<T>(this.kernelCall(method, args, parse ?? (() => undefined as T)));
  }

  /**
   * Open a job for `provider`, as the signer (the client). Answers the new
   * job's id, counted from 1, and the `job_created` event among the events.
   */
  async createJob(params: CreateJobParams): Promise<TransactionResult<bigint>> {
    assertStellarAddress(params.provider);
    return this.kernelWrite<bigint>(
      "create_job",
      { client: this.account, provider: params.provider, expired_at: BigInt(params.expiredAt), description: params.description },
      (value) => scValToNative(value) as bigint,
    );
  }

  /** Set an Open job's budget, as the signer, who must be its client or provider. Base units. */
  async setBudget(jobId: bigint, amount: bigint): Promise<TransactionResult<void>> {
    assertTokenAmount(amount);
    return this.kernelWrite("set_budget", { caller: this.account, job_id: jobId, amount });
  }

  /**
   * Escrow the budget, as the signer (the client): one signature covers the
   * call and the token transfer beneath it. `expectedBudget` is what the
   * signer agreed to; the kernel refuses if the budget was changed meanwhile.
   */
  async fund(jobId: bigint, expectedBudget: bigint): Promise<TransactionResult<void>> {
    assertTokenAmount(expectedBudget);
    return this.kernelWrite("fund", { client: this.account, job_id: jobId, expected_budget: expectedBudget });
  }

  /**
   * Record the deliverable, as the signer (the provider): its 32-byte hash,
   * or the content itself, hashed here (`deliverableHash`). Starts the
   * challenge window; the `submitted` event carries `finalizeAfter`.
   */
  async submit(jobId: bigint, deliverable: string | Uint8Array): Promise<TransactionResult<void>> {
    return this.kernelWrite("submit", { provider: this.account, job_id: jobId, deliverable: Buffer.from(deliverableHash(deliverable)) });
  }

  /** Settle a Submitted job whose window has passed; anyone may, the signer only pays the fee. */
  async finalize(jobId: bigint): Promise<TransactionResult<void>> {
    return this.kernelWrite("finalize", { job_id: jobId });
  }

  /**
   * Close a job, as the signer (the client): while Open or Funded at any
   * time, while Submitted inside the challenge window. An escrowed budget is
   * credited back to the client, to be withdrawn.
   */
  async reject(jobId: bigint, reason: string): Promise<TransactionResult<void>> {
    return this.kernelWrite("reject", { client: this.account, job_id: jobId, reason });
  }

  /** Credit a Funded job's budget back to its client once it has expired without a submission; anyone may. */
  async claimRefund(jobId: bigint): Promise<TransactionResult<void>> {
    return this.kernelWrite("claim_refund", { job_id: jobId });
  }

  /**
   * Pay `amount` of the signer's withdrawable balance out to `to`. An
   * account receiving an issued asset needs its trustline (`assertReceivable`);
   * XLM needs none.
   */
  async withdrawTo(to: string, amount: bigint): Promise<TransactionResult<void>> {
    assertStellarAddress(to);
    assertTokenAmount(amount);
    return this.kernelWrite("withdraw_to", { account: this.account, to, amount });
  }

  /** `withdrawTo` the signer itself. */
  async withdraw(amount: bigint): Promise<TransactionResult<void>> {
    return this.withdrawTo(this.account, amount);
  }

  /** A job by id; `SquareContractError` with `InvalidJob` for an id no job has. */
  async getJob(jobId: bigint): Promise<SquareJob> {
    return toSquareJob(jobId, await this.kernelRead<JobRecord>("get_job", { job_id: jobId }));
  }

  /** What `account` (the signer when omitted) may withdraw, in base units. */
  async withdrawable(account?: string): Promise<bigint> {
    return this.kernelRead<bigint>("withdrawable", { account: account ?? this.account });
  }

  /** The id of the last job created; zero before the first. */
  async jobCounter(): Promise<bigint> {
    return this.kernelRead<bigint>("job_counter");
  }

  /** The kernel's settings: the token, the challenge window in seconds, the fee in bps. */
  async kernelConfig(): Promise<KernelConfig> {
    return toKernelConfig(await this.kernelRead<KernelConfigRecord>("config"));
  }

  /** The kernel's owner, who receives the fees. */
  async kernelOwner(): Promise<string> {
    return this.kernelRead<string>("owner");
  }

  /** The kernel's escrowed and withdrawable totals, and the token balance above them. */
  async kernelTotals(): Promise<{ escrowed: bigint; withdrawable: bigint; unaccounted: bigint }> {
    const [escrowed, withdrawable, unaccounted] = await Promise.all([
      this.kernelRead<bigint>("total_escrowed"),
      this.kernelRead<bigint>("total_withdrawable"),
      this.kernelRead<bigint>("unaccounted"),
    ]);
    return { escrowed, withdrawable, unaccounted };
  }

  // ---- the payment token -----------------------------------------------------

  /** The payment token as an `Asset`: native XLM, or the issued asset. */
  get tokenAsset(): Asset {
    return assetOf(this.deployment.token);
  }

  private trustlineKey(account: string): xdr.LedgerKey {
    return xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({ accountId: Keypair.fromPublicKey(account).xdrAccountId(), asset: this.tokenAsset.toTrustLineXDRObject() }),
    );
  }

  private accountKey(account: string): xdr.LedgerKey {
    return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(account).xdrAccountId() }));
  }

  /**
   * Where an address stands with the payment token, read from the ledger
   * without a simulation: native XLM needs no trustline and neither does a
   * contract; an account needs one before it can hold or receive an issued
   * asset, and a missing one is what every transfer to it would fail on.
   */
  async trustline(address: string): Promise<Trustline> {
    await this.assertNetwork();
    if (this.deployment.token.native) return { status: "native" };
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

  async hasTrustline(address: string): Promise<boolean> {
    return (await this.trustline(address)).status !== "missing";
  }

  /** Throws `TrustlineMissingError` for an account that could not be paid in the token. */
  async assertReceivable(address: string): Promise<void> {
    if ((await this.trustline(address)).status === "missing") {
      throw new TrustlineMissingError(address, `${this.deployment.token.code}:${this.deployment.token.issuer}`);
    }
  }

  /**
   * The payment token held, in base units: an account's XLM balance, or its
   * trustline's balance for an issued asset (zero with no trustline, which
   * `trustline` tells apart from an empty one); the SAC's balance entry for
   * a contract.
   */
  async tokenBalance(address: string): Promise<bigint> {
    await this.assertNetwork();
    if (addressKind(address) === "contract") {
      const { balanceEntry } = await this.server.getSACBalance(address, this.tokenAsset, this.deployment.networkPassphrase);
      return balanceEntry ? BigInt(balanceEntry.amount) : 0n;
    }
    if (this.deployment.token.native) {
      const { entries } = await this.server.getLedgerEntries(this.accountKey(address));
      const entry = entries[0];
      if (!entry || entry.val.switch() !== xdr.LedgerEntryType.account()) return 0n;
      return BigInt(entry.val.account().balance().toString());
    }
    const line = await this.trustline(address);
    return line.status === "open" ? line.balance : 0n;
  }

  /**
   * Open the signer's trustline to the payment token, through the SAC's own
   * `trust` (CAP-0073): one simulated, signed invocation under the account's
   * authorization, rather than a classic operation. Null when none is
   * needed: for native XLM, or a signer that is a contract. The account
   * needs the reserve a trustline takes, half an XLM (auth-and-token-flow.md,
   * "Account reserves").
   */
  async trustToken(): Promise<TransactionResult<void> | null> {
    const signer = this.requireSigner();
    if (this.deployment.token.native || addressKind(signer.address) === "contract") return null;
    return this.write<void>({
      contract: "token",
      method: "trust",
      args: [nativeToScVal(signer.address, { type: "address" })],
      parse: () => undefined,
    });
  }
}

/** A topic filter position as the endpoint takes it: base64 XDR, or `*`. */
function topicScVal(filter: TopicFilter): string {
  if (filter === "*") return "*";
  if ("symbol" in filter) return nativeToScVal(filter.symbol, { type: "symbol" }).toXDR("base64");
  if ("address" in filter) return nativeToScVal(filter.address, { type: "address" }).toXDR("base64");
  if ("u64" in filter) return nativeToScVal(BigInt(filter.u64), { type: "u64" }).toXDR("base64");
  if ("u32" in filter) return nativeToScVal(filter.u32, { type: "u32" }).toXDR("base64");
  return nativeToScVal(filter.string, { type: "string" }).toXDR("base64");
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
