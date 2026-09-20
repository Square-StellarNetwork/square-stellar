import {
  deploymentFromJson,
  deployments,
  networkFor,
  STELLAR_LOCAL_HORIZON_URL,
  STELLAR_LOCAL_RPC_URL,
  STELLAR_TESTNET_EXPLORER_URL,
  STELLAR_TESTNET_HORIZON_URL,
  STELLAR_TESTNET_RPC_URL,
  type SquareDeployment,
  type StellarNetworkId,
  type StellarNetworkProfile,
} from "@squaresdk/core/stellar";
import { Asset } from "@stellar/stellar-sdk";

/**
 * Which network this build talks to, and how to reach it (#39, #1).
 *
 * `NEXT_PUBLIC_NETWORK` is `testnet` or `local`; anything else falls back to
 * testnet, which is what the chain id variable did before. The endpoints
 * default to the network profile's and are overridable, because a local
 * quickstart or a private RPC is a deployment choice, not a code change.
 */

export const NETWORK_ID: StellarNetworkId = (process.env.NEXT_PUBLIC_NETWORK ?? "").trim() === "local" ? "stellar:local" : "stellar:testnet";

export const network: StellarNetworkProfile = networkFor(NETWORK_ID);

/** Testnet is the public network; `local` is a quickstart the developer runs. */
export const isTestnet: boolean = NETWORK_ID === "stellar:testnet";

export const NETWORK_LABEL: string = network.name;
export const NETWORK_PASSPHRASE: string = network.networkPassphrase;

const override = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : null;
};

export const rpcUrl: string = override(process.env.NEXT_PUBLIC_RPC_URL) ?? (isTestnet ? STELLAR_TESTNET_RPC_URL : STELLAR_LOCAL_RPC_URL);
export const horizonUrl: string = override(process.env.NEXT_PUBLIC_HORIZON_URL) ?? (isTestnet ? STELLAR_TESTNET_HORIZON_URL : STELLAR_LOCAL_HORIZON_URL);

/** stellar.expert covers the public networks; a local quickstart has no explorer. */
export const explorerUrl: string | null = isTestnet ? STELLAR_TESTNET_EXPLORER_URL : null;

export type ExplorerSubject = "account" | "contract" | "tx";

export function explorerLink(subject: ExplorerSubject, id: string): string | null {
  return explorerUrl === null ? null : `${explorerUrl}/${subject}/${id}`;
}

/** XLM through its own Stellar Asset Contract: what the testnet MVP funds in. */
export const NATIVE_SAC_ID: string = Asset.native().contractId(network.networkPassphrase);

/**
 * What to call the token a contract id names: the two the stack can be
 * deployed with, and the id itself for anything else.
 */
export function tokenLabel(contractId: string | undefined): string {
  if (contractId === undefined) return "";
  if (contractId === NATIVE_SAC_ID) return "XLM";
  if (contractId === network.usdc?.contractId || contractId === deployment?.usdc.contractId) return "USDC";
  return `${contractId.slice(0, 4)}…${contractId.slice(-4)}`;
}

export const DOCS_URL = "https://github.com/Square-StellarNetwork/square-stellar/tree/main/docs/design";
export const REPO_URL = "https://github.com/Square-StellarNetwork/square-stellar";
export const SITE_URL = "https://square-protocol.vercel.app";

/**
 * The contract ids. They come from `@squaresdk/core`'s compiled record for
 * this network, which the deploy scripts write (#19), or from
 * `NEXT_PUBLIC_DEPLOYMENT`, a record's JSON, for a stack that is not in the
 * package yet. A build pointed at a network with neither is not a broken
 * build: every page says so, rather than reading a contract that is not there.
 */
export const deployment: SquareDeployment | null = readDeployment();

export class DeploymentUnconfiguredError extends Error {
  constructor(readonly network: StellarNetworkId) {
    super(
      `no Square deployment for ${network}: set NEXT_PUBLIC_DEPLOYMENT to the contents of contracts/deployments/${network.slice("stellar:".length)}.json, or use a build of @squaresdk/core that carries it`,
    );
    this.name = "DeploymentUnconfiguredError";
  }
}

export function requireDeployment(): SquareDeployment {
  if (deployment === null) throw new DeploymentUnconfiguredError(NETWORK_ID);
  return deployment;
}

function readDeployment(): SquareDeployment | null {
  const inline = (process.env.NEXT_PUBLIC_DEPLOYMENT ?? "").trim();
  if (inline.length > 0) {
    const parsed = deploymentFromJson(JSON.parse(inline) as unknown);
    if (parsed.network !== NETWORK_ID) {
      throw new Error(`NEXT_PUBLIC_DEPLOYMENT is for ${parsed.network} and NEXT_PUBLIC_NETWORK is ${NETWORK_ID}`);
    }
    return parsed;
  }
  return deployments[NETWORK_ID] ?? null;
}
