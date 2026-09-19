import { parseEventLogs, zeroAddress, type Address, type Log } from "viem";

/**
 * The slice of ERC-8004's IdentityRegistry the app writes to, and the read of
 * the receipt that says what a registration minted. No wallet and no RPC in
 * this module, so it is tested against a fixture receipt.
 */

/** ERC-8004 `register(string agentURI)` and the bare `register()`, kept apart so neither viem nor TypeScript picks between overloads by arity. */
export const REGISTER_WITH_URI_ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
] as const;
export const REGISTER_BARE_ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "agentId", type: "uint256" }] },
] as const;
/** The registry is an ERC-721: a mint is a Transfer from the zero address. */
export const TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

/**
 * The agent id a registration minted, read from the receipt rather than from
 * the simulated return value: `register` is permissionless, so between the
 * simulation and the block someone else's registration can take the id the
 * simulation predicted. The receipt is the only account of what happened.
 */
export function mintedAgentId(args: { logs: readonly Log[]; registry: Address; owner: Address }): bigint {
  const registry = args.registry.toLowerCase();
  const owner = args.owner.toLowerCase();
  const mints = parseEventLogs({ abi: TRANSFER_EVENT_ABI, eventName: "Transfer", logs: [...args.logs] }).filter(
    (log) => log.address.toLowerCase() === registry && log.args.from.toLowerCase() === zeroAddress && log.args.to.toLowerCase() === owner,
  );
  if (mints.length === 0) throw new RegistrationError("The transaction was mined but minted no agent to this wallet.");
  if (mints.length > 1) throw new RegistrationError(`The transaction minted ${mints.length} agents, so the DID would be ambiguous.`);
  return mints[0]!.args.tokenId;
}
