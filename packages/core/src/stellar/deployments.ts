import { isAccountAddress, isContractAddress } from "./address.js";
import { isStellarNetworkId, networks, passphraseOf, usdcAsset, type StellarNetworkId, type UsdcAsset } from "./network.js";

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

/**
 * The three 8004 registries the hook writes to and the DID resolver reads.
 * Which deployment of them a network uses is #33's decision; the record
 * carries the answer, so nothing here depends on it.
 */
export const AGENT_REGISTRIES = ["identity", "reputation", "validation"] as const;

export type AgentRegistryName = (typeof AGENT_REGISTRIES)[number];

export interface SquareDeployment {
  network: StellarNetworkId;
  networkPassphrase: string;
  squareJob: string;
  keeperEvaluator: string;
  arbitration: string;
  claimMarket: string;
  squareHook: string;
  policyRegistry: string;
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
  usdc: UsdcAsset;
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
  /** The ledger the record was written at: where an indexer starts reading events from. */
  deployLedger?: number;
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

/**
 * The deployments compiled into this package, one per network, filled in as
 * the stacks are deployed: the local stack's record is written by its deployer
 * (#43) and read from disk, the testnet record by #45. Until then
 * `deploymentFor` knows nothing and says so. A test asserts that whatever is
 * here agrees with contracts/deployments/<network>.json, the record the
 * deploy scripts write.
 */
export const deployments: Readonly<Partial<Record<StellarNetworkId, SquareDeployment>>> = {};

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

const OPTIONAL_CONTRACTS: ReadonlySet<SquareContractName> = new Set(["compliance_module", "screening_registry", "groth16_verifier"]);

const registryFields: Record<AgentRegistryName, keyof SquareDeployment> = {
  identity: "identityRegistry",
  reputation: "reputationRegistry",
  validation: "validationRegistry",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractId(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !isContractAddress(value)) {
    throw new InvalidDeploymentError(`${where}.${key} is not a contract address (C…)`);
  }
  return value;
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
 *   "contracts": { "square_job": "C…", "keeper_evaluator": "C…", … },
 *   "usdc": { "issuer": "G…", "contractId": "C…" },
 *   "registries": { "identity": "C…", "reputation": "C…", "validation": "C…" }
 * }
 * ```
 *
 * `contracts` names the crates; `compliance_module`, `groth16_verifier` and
 * `screening_registry` may be absent. Every id is checked to be a strkey of
 * the right kind, the passphrase to be the network's, and on a network whose
 * profile names USDC (testnet), the record's USDC to be that one: the
 * payment token is Circle's, not a test asset (stellar-target.md).
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
    if (OPTIONAL_CONTRACTS.has(name) && (contracts[name] === undefined || contracts[name] === null)) continue;
    out[contractFields[name]] = contractId(contracts, name, "contracts");
  }
  const usdc = json["usdc"];
  if (!isRecord(usdc)) throw new InvalidDeploymentError("usdc is missing");
  const issuer = usdc["issuer"];
  if (typeof issuer !== "string" || !isAccountAddress(issuer)) throw new InvalidDeploymentError("usdc.issuer is not an account address (G…)");
  const derived = usdcAsset(issuer, networkPassphrase);
  if (typeof usdc["contractId"] !== "string") throw new InvalidDeploymentError("usdc.contractId is missing");
  if (usdc["contractId"] !== derived.contractId) {
    throw new InvalidDeploymentError(`usdc.contractId is not the SAC of USDC:${issuer} on ${network}, which is ${derived.contractId}`);
  }
  if (usdc["decimals"] !== undefined && usdc["decimals"] !== 7) throw new InvalidDeploymentError("usdc.decimals must be 7: a SAC has 7");
  const profile = networks[network];
  if (profile?.usdc && profile.usdc.issuer !== issuer) {
    throw new InvalidDeploymentError(`usdc.issuer is ${issuer}; on ${network} USDC is issued by ${profile.usdc.issuer}`);
  }
  out["usdc"] = derived;
  const registries = json["registries"];
  if (!isRecord(registries)) throw new InvalidDeploymentError("registries is missing");
  for (const name of AGENT_REGISTRIES) out[registryFields[name]] = contractId(registries, name, "registries");
  const ledger = json["ledger"];
  if (ledger !== undefined && ledger !== null) {
    if (typeof ledger !== "number" || !Number.isInteger(ledger) || ledger < 0) throw new InvalidDeploymentError("ledger is not a ledger sequence");
    out["deployLedger"] = ledger;
  }
  return out as unknown as SquareDeployment;
}

/** Every contract the record names, with its crate name; the payment token as `usdc`. */
export function contractsOf(deployment: SquareDeployment): ReadonlyMap<string, SquareContractName | "usdc"> {
  const byId = new Map<string, SquareContractName | "usdc">();
  for (const name of SQUARE_CONTRACTS) {
    const id = deployment[contractFields[name]];
    if (typeof id === "string") byId.set(id, name);
  }
  byId.set(deployment.usdc.contractId, "usdc");
  return byId;
}

/** The id the record holds for a contract, or undefined when it names none. */
export function contractIdOf(deployment: SquareDeployment, name: SquareContractName | "usdc"): string | undefined {
  if (name === "usdc") return deployment.usdc.contractId;
  const id = deployment[contractFields[name]];
  return typeof id === "string" ? id : undefined;
}
