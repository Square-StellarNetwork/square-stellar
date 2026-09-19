import { encodeEventTopics, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { mintedAgentId, RegistrationError, TRANSFER_EVENT_ABI } from "./registry";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const OWNER = "0xa52c81e6aD0d73f001c911d906a907e5E36733A2" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function transfer(address: `0x${string}`, from: `0x${string}`, to: `0x${string}`, tokenId: bigint): Log {
  const topics = encodeEventTopics({ abi: TRANSFER_EVENT_ABI, eventName: "Transfer", args: { from, to, tokenId } });
  return { address, topics, data: "0x", blockNumber: 1n, transactionHash: `0x${"cd".repeat(32)}`, transactionIndex: 0, blockHash: `0x${"ef".repeat(32)}`, logIndex: 0, removed: false } as Log;
}

describe("the agent id a registration minted", () => {
  it("is the token the registry transferred from the zero address to the owner", () => {
    const logs = [transfer(REGISTRY, ZERO, OWNER, 892531n), transfer("0x0000000000000000000000000000000000000001", ZERO, OWNER, 1n), transfer(REGISTRY, OWNER, ZERO, 7n)];
    expect(mintedAgentId({ logs, registry: REGISTRY, owner: OWNER })).toBe(892531n);
    expect(mintedAgentId({ logs, registry: REGISTRY.toLowerCase() as `0x${string}`, owner: OWNER.toLowerCase() as `0x${string}` })).toBe(892531n);
  });

  it("refuses a receipt that minted nothing to the wallet, or more than one thing", () => {
    expect(() => mintedAgentId({ logs: [transfer(REGISTRY, ZERO, "0x0000000000000000000000000000000000000002", 1n)], registry: REGISTRY, owner: OWNER })).toThrow(RegistrationError);
    expect(() => mintedAgentId({ logs: [transfer(REGISTRY, ZERO, OWNER, 1n), transfer(REGISTRY, ZERO, OWNER, 2n)], registry: REGISTRY, owner: OWNER })).toThrow(/2 agents/);
  });
});
