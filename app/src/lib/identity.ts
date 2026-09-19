"use client";

import { AipDidResolver, defaultFetchAgentUri, formatDid, type DidResolutionResult } from "@squaresdk/did-resolver";
import { useQuery } from "@tanstack/react-query";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { RegistrationCard } from "./agents";
import { mintedAgentId, REGISTER_BARE_ABI, REGISTER_WITH_URI_ABI, RegistrationError } from "./registry";
import { activeChain, deployment, publicClient, rpcUrl } from "./wagmi";

/**
 * The chain side of the agents page: registering an ERC-8004 identity and
 * resolving one. Everything a wallet or an RPC touches is here, so that the
 * page and the pure logic in agents.ts stay free of it, and so that the
 * chain layer is one file to swap.
 */

export interface RegisteredAgent {
  hash: Hex;
  agentId: bigint;
  did: string;
}

/**
 * Register an agent for the connected wallet: simulate, send, wait for the
 * receipt, and read the id the chain actually minted. An empty URI sends the
 * no-argument `register()`, which ERC-8004 allows: the agent exists and is
 * owned, and its DID resolves with an empty service list.
 */
export async function registerAgent(params: {
  walletClient: WalletClient;
  client?: PublicClient;
  owner: Address;
  agentUri: string;
  registry?: Address;
}): Promise<RegisteredAgent> {
  const client = params.client ?? publicClient;
  const registry = params.registry ?? deployment.identityRegistry;
  const uri = params.agentUri.trim();
  // Two branches rather than one union: viem types `writeContract` by the
  // ABI the simulation returned, and the two overloads have different ABIs.
  let hash: Hex;
  if (uri.length > 0) {
    const { request } = await client.simulateContract({ account: params.owner, address: registry, abi: REGISTER_WITH_URI_ABI, functionName: "register", args: [uri] });
    hash = await params.walletClient.writeContract({ ...request, account: params.owner, chain: activeChain });
  } else {
    const { request } = await client.simulateContract({ account: params.owner, address: registry, abi: REGISTER_BARE_ABI, functionName: "register" });
    hash = await params.walletClient.writeContract({ ...request, account: params.owner, chain: activeChain });
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new RegistrationError(`Transaction ${hash} was mined and reverted.`);
  const agentId = mintedAgentId({ logs: receipt.logs, registry, owner: params.owner });
  return { hash, agentId, did: formatDid(activeChain.id, registry, agentId) };
}

// -------------------------------------------------------------------- resolving

export interface Resolution {
  result: DidResolutionResult;
  /** The registration file as fetched, when the agent named one and it could be read. */
  card: RegistrationCard | null;
}

/**
 * Resolve one DID through @squaresdk/did-resolver, keeping the registration
 * file it fetched so the page can show the card and not only the DID
 * document derived from it. The resolver honours this deployment's registry
 * only, as the CLI does: a DID that names another registry is refused rather
 * than read, since anyone can deploy the interface (spec §10.1).
 */
export async function resolveAgent(did: string, options: { fetch?: typeof globalThis.fetch } = {}): Promise<Resolution> {
  let card: RegistrationCard | null = null;
  const resolver = new AipDidResolver({
    rpc: { [activeChain.id]: rpcUrl },
    allowedRegistries: [deployment.identityRegistry],
    fetchAgentUri: async (uri) => {
      const doc = await defaultFetchAgentUri(uri, options.fetch ? { fetch: options.fetch } : {});
      if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) card = doc as RegistrationCard;
      return doc;
    },
  });
  const result = await resolver.resolve(did);
  return { result, card };
}

export function useResolution(did: string | null) {
  return useQuery({
    queryKey: ["did", activeChain.id, did],
    enabled: did !== null,
    staleTime: 30_000,
    queryFn: () => resolveAgent(did as string),
  });
}
