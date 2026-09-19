import { Asset, Networks } from "@stellar/stellar-sdk";

/**
 * The networks this package knows, keyed by the string every other package
 * uses for them: the CAIP-2 id for the public networks, and `stellar:local`
 * for a quickstart network, which has no CAIP-2 id. The values are the ones
 * docs/decisions/stellar-target.md fixes; that page is the source, this file is
 * the one place they are declared in code (test/single-source.test.ts).
 */
export type StellarNetworkId = "stellar:testnet" | "stellar:pubnet" | "stellar:local";

/** The CAIP-2 ids of the public networks (https://namespaces.chainagnostic.org/stellar/caip2). */
export type StellarCaip2 = "stellar:testnet" | "stellar:pubnet";

/**
 * Circle's USDC as a Stellar Asset Contract (SAC). Amounts are base units at
 * 7 decimals everywhere in this package: `usdcUnits` and `formatUsdc` convert.
 */
export interface UsdcAsset {
  code: "USDC";
  /** The issuing account, `G…`, from Circle's contract-address page. */
  issuer: string;
  /** The SAC, `C…`, derived from the asset and the network passphrase. */
  contractId: string;
  decimals: 7;
}

/**
 * Everything about a network that is not a Square contract id. The shape is
 * the one docs/decisions/stellar-target.md decides ("Network profile"), with
 * two additions: `id`, the key this package looks a network up by, and `usdc`
 * being undefined on a local network, where the local stack issues its own
 * USDC and the deployment record names it.
 */
export interface StellarNetworkProfile {
  id: StellarNetworkId;
  /** Network passphrase; the identity of the network. `rpc.Server.getNetwork()` answers it. */
  networkPassphrase: string;
  /** CAIP-2 id (`stellar:testnet`, `stellar:pubnet`); undefined on a local network. */
  caip2: StellarCaip2 | undefined;
  name: string;
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl: string | undefined;
  explorerUrl: string | undefined;
  usdc: UsdcAsset | undefined;
}

export const STELLAR_TESTNET_PASSPHRASE: string = Networks.TESTNET;
export const STELLAR_PUBNET_PASSPHRASE: string = Networks.PUBLIC;
/** quickstart `--local` (stellar-target.md, "Networks"). */
export const STELLAR_LOCAL_PASSPHRASE: string = Networks.STANDALONE;

export const STELLAR_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
export const STELLAR_TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const STELLAR_TESTNET_FRIENDBOT_URL = "https://friendbot.stellar.org";
export const STELLAR_TESTNET_EXPLORER_URL = "https://stellar.expert/explorer/testnet";

export const STELLAR_LOCAL_RPC_URL = "http://localhost:8000/rpc";
export const STELLAR_LOCAL_HORIZON_URL = "http://localhost:8000";
export const STELLAR_LOCAL_FRIENDBOT_URL = "http://localhost:8000/friendbot";

/** Circle's testnet USDC issuer (stellar-target.md, "USDC"). */
export const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * A SAC's id is a function of the asset and the network passphrase, so the
 * issuer is the one value declared and the id is derived, the way
 * `stellar contract id asset` derives it. The decision record lists the
 * derived id; a test asserts this derivation lands on it.
 */
export function usdcAsset(issuer: string, networkPassphrase: string): UsdcAsset {
  return { code: "USDC", issuer, contractId: new Asset("USDC", issuer).contractId(networkPassphrase), decimals: 7 };
}

const testnet: StellarNetworkProfile = {
  id: "stellar:testnet",
  networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
  caip2: "stellar:testnet",
  name: "Stellar Testnet",
  rpcUrl: STELLAR_TESTNET_RPC_URL,
  horizonUrl: STELLAR_TESTNET_HORIZON_URL,
  friendbotUrl: STELLAR_TESTNET_FRIENDBOT_URL,
  explorerUrl: STELLAR_TESTNET_EXPLORER_URL,
  usdc: usdcAsset(USDC_TESTNET_ISSUER, STELLAR_TESTNET_PASSPHRASE),
};

const local: StellarNetworkProfile = {
  id: "stellar:local",
  networkPassphrase: STELLAR_LOCAL_PASSPHRASE,
  caip2: undefined,
  name: "Local",
  rpcUrl: STELLAR_LOCAL_RPC_URL,
  horizonUrl: STELLAR_LOCAL_HORIZON_URL,
  friendbotUrl: STELLAR_LOCAL_FRIENDBOT_URL,
  explorerUrl: undefined,
  usdc: undefined,
};

/**
 * Testnet and local. Pubnet has a passphrase and a CAIP-2 id below, so an
 * endpoint that turns out to be pubnet is named as such in an error, but no
 * profile: nothing targets it yet, and it has no SDF RPC endpoint to name
 * (stellar-target.md, "The decision").
 */
export const networks: Readonly<Partial<Record<StellarNetworkId, StellarNetworkProfile>>> = {
  "stellar:testnet": testnet,
  "stellar:local": local,
};

const passphrases: Readonly<Record<StellarNetworkId, string>> = {
  "stellar:testnet": STELLAR_TESTNET_PASSPHRASE,
  "stellar:pubnet": STELLAR_PUBNET_PASSPHRASE,
  "stellar:local": STELLAR_LOCAL_PASSPHRASE,
};

export class UnknownNetworkError extends Error {
  constructor(readonly network: string) {
    super(`No network profile is known for ${JSON.stringify(network)}`);
    this.name = "UnknownNetworkError";
  }
}

export function isStellarNetworkId(value: unknown): value is StellarNetworkId {
  return typeof value === "string" && Object.hasOwn(passphrases, value);
}

/** The network a passphrase identifies, or undefined for one this package does not know. */
export function networkIdOf(passphrase: string): StellarNetworkId | undefined {
  for (const [id, known] of Object.entries(passphrases)) if (known === passphrase) return id as StellarNetworkId;
  return undefined;
}

/** The passphrase of a network this package knows. */
export function passphraseOf(network: StellarNetworkId): string {
  return passphrases[network];
}

/**
 * The profile of a network, by id or by passphrase. Throws
 * `UnknownNetworkError` for pubnet as well as for a passphrase nobody knows,
 * since neither has a profile.
 */
export function networkFor(idOrPassphrase: string): StellarNetworkProfile {
  const id = isStellarNetworkId(idOrPassphrase) ? idOrPassphrase : networkIdOf(idOrPassphrase);
  const found = id === undefined ? undefined : networks[id];
  if (!found) throw new UnknownNetworkError(idOrPassphrase);
  return found;
}
