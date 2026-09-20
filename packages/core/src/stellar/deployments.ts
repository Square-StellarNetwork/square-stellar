import { isAccountAddress, isContractAddress } from "./address.js";
import { isStellarNetworkId, issuedToken, nativeToken, networks, passphraseOf, usdcAsset, type PaymentToken, type StellarNetworkId, type UsdcAsset } from "./network.js";

/**
 * The nine Soroban contracts, by crate name (contracts/contracts/<name>),
 * which is also the name of the built Wasm, of the generated bindings
 * directory and of the key in a deployment record.
 */
export const SQUARE_CONTRACTS = [
  "square_job",
  "keeper_evaluator",
  "arbitration",
  "claim_market",
  "square_hook",
  "policy_registry",
  "compliance_module",
  "screening_registry",
  "groth16_verifier",
] as const;

export type SquareContractName = (typeof SQUARE_CONTRACTS)[number];

/** What a deployment record can name besides the crates: the payment token, and USDC when it is not the token. */
export type TokenName = "token" | "usdc";

/**
 * The three 8004 registries the hook writes to and the DID resolver reads.
 * Which deployment of them a network uses is #33's decision; the record
 * carries the answer, so nothing here depends on it.
 */
export const AGENT_REGISTRIES = ["identity", "reputation", "validation"] as const;

export type AgentRegistryName = (typeof AGENT_REGISTRIES)[number];

/**
 * A deployment. The MVP (milestone "MVP — testnet") deploys the kernel alone,
 * paid in native XLM, so only `squareJob` and `token` are certain; the other
 * contracts, USDC and the 8004 registries arrive with their phase-2 issues
 * and are named by the record when they exist.
 */
export interface SquareDeployment {
  network: StellarNetworkId;
  networkPassphrase: string;
  squareJob: string;
  keeperEvaluator?: string;
  arbitration?: string;
  claimMarket?: string;
  squareHook?: string;
  policyRegistry?: string;
  /**
   * The compliance module in the hook's slot and the verifier it calls, when
   * the record names them. Optional because a stack can run with the slot
   * empty (docs/design/compliance-gate.md); what the hook actually holds is
   * read from the hook.
   */
  complianceModule?: string;
  groth16Verifier?: string;
  /** The sanctions screening registry, when the record names one; same reasoning. */
  screeningRegistry?: string;
  /** The token the kernel was deployed with: what every job is paid in. */
  token: PaymentToken;
  /** Circle's USDC on this network, when the record names it (phase 2; the token itself when the kernel is paid in USDC). */
  usdc?: UsdcAsset;
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
  /** The ledger the record was written at: where an indexer starts reading events from. */
  deployLedger?: number;
  /**
   * The sha256 of the Wasm each contract was deployed from, by crate name,
   * when the record carries it: what `check:deployed-wasm` compares the
   * contract instance's executable hash and the working tree's build with.
   */
  wasm?: Partial<Record<SquareContractName, string>>;
}

export class UnknownDeploymentError extends Error {
  constructor(readonly network: string) {
    super(`No Square deployment is known for ${JSON.stringify(network)}`);
    this.name = "UnknownDeploymentError";
  }
}

export class InvalidDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDeploymentError";
  }
}

export function deploymentFor(network: StellarNetworkId): SquareDeployment {
  const found = deployments[network];
  if (!found) throw new UnknownDeploymentError(network);
  return found;
}

/** The record's file name for a network: `stellar:testnet` → `testnet.json`. */
export function deploymentFileName(network: StellarNetworkId): string {
  return `${network.slice("stellar:".length)}.json`;
}

const contractFields: Record<SquareContractName, keyof SquareDeployment> = {
  square_job: "squareJob",
  keeper_evaluator: "keeperEvaluator",
  arbitration: "arbitration",
  claim_market: "claimMarket",
  square_hook: "squareHook",
  policy_registry: "policyRegistry",
  compliance_module: "complianceModule",
  screening_registry: "screeningRegistry",
  groth16_verifier: "groth16Verifier",
};

/** The kernel is the deployment; everything else is named when it exists. */
const REQUIRED_CONTRACTS: ReadonlySet<SquareContractName> = new Set(["square_job"]);

const registryFields: Record<AgentRegistryName, keyof SquareDeployment> = {
  identity: "identityRegistry",
  reputation: "reputationRegistry",
  validation: "validationRegistry",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function contractId(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !isContractAddress(value)) {
    throw new InvalidDeploymentError(`${where}.${key} is not a contract address (C…)`);
  }
  return value;
}

/**
 * `token` in a record: `{ "code": "XLM" }` for the native asset, or
 * `{ "code": "USDC", "issuer": "G…" }` for an issued one; a `contractId`
 * given alongside must be the SAC those derive to, so a record cannot name a
 * token that is not the asset it says.
 */
function paymentToken(json: unknown, networkPassphrase: string): PaymentToken {
  if (!isRecord(json)) throw new InvalidDeploymentError("token is missing: the asset the kernel is paid in");
  const code = json["code"];
  if (typeof code !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(code)) throw new InvalidDeploymentError("token.code is not an asset code");
  const issuer = json["issuer"];
  let token: PaymentToken;
  if (code.toUpperCase() === "XLM" && isAbsent(issuer)) {
    token = nativeToken(networkPassphrase);
  } else {
    if (typeof issuer !== "string" || !isAccountAddress(issuer)) throw new InvalidDeploymentError(`token.issuer is not an account address (G…); only XLM has no issuer`);
    token = issuedToken(code, issuer, networkPassphrase);
  }
  if (!isAbsent(json["contractId"]) && json["contractId"] !== token.contractId) {
    throw new InvalidDeploymentError(`token.contractId is not the SAC of ${token.issuer ? `${token.code}:${token.issuer}` : "native XLM"} on this network, which is ${token.contractId}`);
  }
  if (!isAbsent(json["decimals"]) && json["decimals"] !== 7) throw new InvalidDeploymentError("token.decimals must be 7: a SAC has 7");
  return token;
}

/**
 * A deployment record as `contracts/deployments/<network>.json` holds it,
 * written by the deploy scripts (#19) and read by every service through
 * `SQUARE_DEPLOYMENT_FILE`:
 *
 * ```json
 * {
 *   "network": "stellar:testnet",
 *   "networkPassphrase": "Test SDF Network ; September 2015",
 *   "ledger": 4760307,
 *   "contracts": { "square_job": "C…" },
 *   "token": { "code": "XLM", "contractId": "C…" },
 *   "wasm": { "square_job": "<sha256 of the deployed Wasm>" }
 * }
 * ```
 *
 * `contracts` names the crates and only `square_job` must be there; `token`
 * is the asset the kernel was deployed with (`{ "code": "XLM" }`, or a code
 * with its `issuer`); `wasm` pins each deployed crate's Wasm by sha256;
 * `usdc { issuer, contractId }` and `registries { identity, reputation,
 * validation }` are named when the network has them.
 * Every id is checked to be a strkey of the right kind, the passphrase to be
 * the network's, every SAC id to be the one its asset derives to, and on a
 * network whose profile names USDC (testnet), the record's USDC to be that
 * one: the payment token is Circle's, not a test asset (stellar-target.md).
 */
export function deploymentFromJson(json: unknown): SquareDeployment {
  if (!isRecord(json)) throw new InvalidDeploymentError("deployment is not an object");
  const network = json["network"];
  if (!isStellarNetworkId(network)) throw new InvalidDeploymentError(`network is not one of stellar:testnet, stellar:pubnet, stellar:local: ${JSON.stringify(network)}`);
  const networkPassphrase = json["networkPassphrase"];
  if (networkPassphrase !== passphraseOf(network)) {
    throw new InvalidDeploymentError(`networkPassphrase ${JSON.stringify(networkPassphrase)} is not ${network}'s`);
  }
  const contracts = json["contracts"];
  if (!isRecord(contracts)) throw new InvalidDeploymentError("contracts is missing");
  const out: Record<string, unknown> = { network, networkPassphrase };
  for (const name of SQUARE_CONTRACTS) {
    if (!REQUIRED_CONTRACTS.has(name) && isAbsent(contracts[name])) continue;
    out[contractFields[name]] = contractId(contracts, name, "contracts");
  }
  out["token"] = paymentToken(json["token"], networkPassphrase);
  const usdc = json["usdc"];
  if (!isAbsent(usdc)) {
    if (!isRecord(usdc)) throw new InvalidDeploymentError("usdc is not an object");
    const issuer = usdc["issuer"];
    if (typeof issuer !== "string" || !isAccountAddress(issuer)) throw new InvalidDeploymentError("usdc.issuer is not an account address (G…)");
    const derived = usdcAsset(issuer, networkPassphrase);
    if (typeof usdc["contractId"] !== "string") throw new InvalidDeploymentError("usdc.contractId is missing");
    if (usdc["contractId"] !== derived.contractId) {
      throw new InvalidDeploymentError(`usdc.contractId is not the SAC of USDC:${issuer} on ${network}, which is ${derived.contractId}`);
    }
    if (!isAbsent(usdc["decimals"]) && usdc["decimals"] !== 7) throw new InvalidDeploymentError("usdc.decimals must be 7: a SAC has 7");
    const profile = networks[network];
    if (profile?.usdc && profile.usdc.issuer !== issuer) {
      throw new InvalidDeploymentError(`usdc.issuer is ${issuer}; on ${network} USDC is issued by ${profile.usdc.issuer}`);
    }
    out["usdc"] = derived;
  }
  const registries = json["registries"];
  if (!isAbsent(registries)) {
    if (!isRecord(registries)) throw new InvalidDeploymentError("registries is not an object");
    for (const name of AGENT_REGISTRIES) {
      if (isAbsent(registries[name])) continue;
      out[registryFields[name]] = contractId(registries, name, "registries");
    }
  }
  const ledger = json["ledger"];
  if (!isAbsent(ledger)) {
    if (typeof ledger !== "number" || !Number.isInteger(ledger) || ledger < 0) throw new InvalidDeploymentError("ledger is not a ledger sequence");
    out["deployLedger"] = ledger;
  }
  const wasm = json["wasm"];
  if (!isAbsent(wasm)) {
    if (!isRecord(wasm)) throw new InvalidDeploymentError("wasm is not an object");
    const hashes: Partial<Record<SquareContractName, string>> = {};
    for (const name of SQUARE_CONTRACTS) {
      const hash = wasm[name];
      if (isAbsent(hash)) continue;
      if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new InvalidDeploymentError(`wasm.${name} is not a sha256 (64 hex digits)`);
      if (isAbsent(contracts[name])) throw new InvalidDeploymentError(`wasm.${name} pins a contract the record does not name`);
      hashes[name] = hash;
    }
    out["wasm"] = hashes;
  }
  return out as unknown as SquareDeployment;
}

/**
 * The deployments compiled into this package, one per network, filled in as
 * the stacks are deployed: the local stack's record is written by its deployer
 * (#43) and read from disk, the testnet record by #19/#45. Until then
 * `deploymentFor` knows nothing and says so. A test asserts that whatever is
 * here agrees with contracts/deployments/<network>.json, the record the
 * deploy scripts write.
 */
export const deployments: Readonly<Partial<Record<StellarNetworkId, SquareDeployment>>> = {
  /**
   * `contracts/deployments/testnet.json` (#45): the kernel the demo runs on,
   * deployed with a 30 s challenge window so a settlement can be watched, and
   * a 2.5 % platform fee. Every value here was read back from the chain — the
   * contract's own `config`, the executable hash of its instance, and the
   * ledger of its first event, which is where an indexer starts. Read through
   * `deploymentFromJson` rather than written out as an object, so the copy
   * compiled in here and the record on disk are the same shape checked the
   * same way; the test compares them field by field.
   */
  "stellar:testnet": deploymentFromJson({
    network: "stellar:testnet",
    // The passphrase is the SDK's, never spelled out here (single-source.test.ts).
    networkPassphrase: passphraseOf("stellar:testnet"),
    ledger: 4766069,
    contracts: { square_job: "CATY3ZGNSS44HY4GAPBBAWQUW4E7YHNHG7GVFLUWPJPO22WP3O5YZVII" },
    token: { code: "XLM", contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
    wasm: { square_job: "e497c6bbea72b06c9080281b1b08d9ec5ee2b3b01154584eb8332ee22e81c2e1" },
  }),
};

/**
 * Every contract the record names, with its crate name; the payment token as
 * `token`, and USDC as `usdc` when the record names it and it is not the
 * token.
 */
export function contractsOf(deployment: SquareDeployment): ReadonlyMap<string, SquareContractName | TokenName> {
  const byId = new Map<string, SquareContractName | TokenName>();
  for (const name of SQUARE_CONTRACTS) {
    const id = deployment[contractFields[name]];
    if (typeof id === "string") byId.set(id, name);
  }
  if (deployment.usdc) byId.set(deployment.usdc.contractId, "usdc");
  byId.set(deployment.token.contractId, "token");
  return byId;
}

/** The id the record holds for a contract, or undefined when it names none. */
export function contractIdOf(deployment: SquareDeployment, name: SquareContractName | TokenName): string | undefined {
  if (name === "token") return deployment.token.contractId;
  if (name === "usdc") return deployment.usdc?.contractId;
  const id = deployment[contractFields[name]];
  return typeof id === "string" ? id : undefined;
}
