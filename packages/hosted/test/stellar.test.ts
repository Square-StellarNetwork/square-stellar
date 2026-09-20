import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import type { ProviderChain } from "@squaresdk/agent/stellar";
import { JobStatus, keypairSigner, nativeToken, STELLAR_TESTNET_PASSPHRASE, type SquareJob } from "@squaresdk/core/stellar";
import { describe, expect, it } from "vitest";
import { parseHostedConfig } from "../src/config.js";
import { sealContext } from "../src/host.js";
import { deriveSealKey, seal } from "../src/sealed.js";
import { hostStellarAgent } from "../src/stellar.js";
import { scriptedModel } from "./helpers/scriptedModel.js";

/**
 * The configuration on Stellar: each capability is a model run on the job's
 * description, delivered through the provider loop. The chain is one job in
 * memory; the model is scripted.
 */
const agentKey = Keypair.random();
const CLIENT = Keypair.random().publicKey();
const deployment = { network: "stellar:testnet" as const, networkPassphrase: STELLAR_TESTNET_PASSPHRASE, squareJob: "CATY3ZGNSS44HY4GAPBBAWQUW4E7YHNHG7GVFLUWPJPO22WP3O5YZVII", token: nativeToken(STELLAR_TESTNET_PASSPHRASE) };

function oneJob(description: string): { chain: ProviderChain; job: SquareJob; submits: string[] } {
  const job: SquareJob = {
    id: 1n,
    client: CLIENT,
    provider: agentKey.publicKey(),
    status: JobStatus.Funded,
    budget: 25_000_000n, // the capability's price, 2.5 XLM: a job funded below it is left alone
    platformFeeBps: 250,
    challengeWindow: 30n,
    createdAt: 1n,
    expiredAt: 10_000n,
    fundedAt: 2n,
    submittedAt: 0n,
    deliverable: undefined,
    description,
    finalizeAfter: undefined,
  };
  const submits: string[] = [];
  const chain: ProviderChain = {
    account: agentKey.publicKey(),
    createdJobs: async () => ({ jobIds: [1n], cursor: "2", now: 100n, latestLedger: 1 }),
    latestLedger: async () => 1,
    getJob: async () => structuredClone(job),
    submit: async (_jobId, content) => {
      submits.push(content);
      job.status = JobStatus.Submitted;
      return { deliverable: createHash("sha256").update(content).digest("hex"), hash: "tx" };
    },
    finalize: async () => ({ hash: "f" }),
    withdrawable: async () => 0n,
    withdraw: async () => ({ hash: "w" }),
  };
  return { chain, job, submits };
}

const config = (over: Record<string, unknown> = {}) =>
  parseHostedConfig({
    name: "Atlas",
    description: "research briefs",
    url: "https://atlas.example",
    provider: { tier: "platform", model: "scripted" },
    capabilities: [{ id: "research.brief", description: "a brief", price: "2.5", instructions: "Write a brief." }],
    ...over,
  });

describe("hostStellarAgent", () => {
  it("runs the capability's instructions through the model on the job's description and delivers the answer", async () => {
    const { chain, submits } = oneJob("the state of Soroban");
    const model = scriptedModel([{ text: "Soroban is live on Protocol 28." }]);
    const runs: string[] = [];
    const hosted = hostStellarAgent(config(), {
      deployment,
      signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE),
      chain,
      anthropic: model,
      onRun: ({ jobId, capability, outcome }) => runs.push(`${capability} ${jobId} ${outcome.text}`),
    });
    expect(hosted.agent.capabilities()).toEqual([{ id: "research.brief", description: "a brief", price: "2.5" }]);
    await hosted.agent.provider.tick();
    expect(submits).toEqual(["Soroban is live on Protocol 28."]);
    expect(runs).toEqual(["research.brief 1 Soroban is live on Protocol 28."]);
    const request = model.requests[0]!;
    expect(request.model).toBe("scripted");
    expect(request.system).toContain("Write a brief.");
    expect(request.messages).toEqual([{ role: "user", content: "the state of Soroban" }]);
    expect(request.tools ?? []).toEqual([]);
    expect(hosted.agent.provider.job(1n)).toMatchObject({ capability: "research.brief", content: "Soroban is live on Protocol 28.", status: "Submitted" });
  });

  it("leaves alone a job funded below the capability's price, without asking the model", async () => {
    const { chain, job, submits } = oneJob("the state of Soroban");
    job.budget = 24_999_999n;
    const model = scriptedModel([{ text: "never asked" }]);
    const hosted = hostStellarAgent(config(), { deployment, signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE), chain, anthropic: model });
    await hosted.agent.provider.tick();
    expect(submits).toEqual([]);
    expect(model.requests).toEqual([]);
    expect(hosted.agent.provider.job(1n)).toMatchObject({ done: true, attempts: 0, error: expect.stringMatching(/costs 25000000/) });
  });

  it("serves the capability the description names, with the rest as the input", async () => {
    const { chain } = oneJob("research.brief: quantum networking");
    const model = scriptedModel([{ text: "ok" }]);
    const hosted = hostStellarAgent(
      config({ capabilities: [...config().capabilities, { id: "translate", description: "into French", instructions: "Translate." }] }),
      { deployment, signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE), chain, anthropic: model },
    );
    await hosted.agent.provider.tick();
    expect(model.requests[0]!.messages).toEqual([{ role: "user", content: "quantum networking" }]);
    expect(model.requests[0]!.system).toContain("Write a brief.");
  });

  it("needs no agentId, and opens an own key sealed under the agent's name", () => {
    const secret = "a-seal-secret-of-sixteen-plus";
    const sealed = seal("sk-ant-own", deriveSealKey(secret), sealContext({ name: "Atlas" }));
    const keys: Array<string | undefined> = [];
    hostStellarAgent(config({ provider: { tier: "own", apiKey: sealed } }), {
      deployment,
      signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE),
      chain: oneJob("x").chain,
      sealSecret: secret,
      anthropic: (apiKey) => {
        keys.push(apiKey);
        return scriptedModel([]);
      },
    });
    expect(keys).toEqual(["sk-ant-own"]);
    expect(() => hostStellarAgent(config({ provider: { tier: "own", apiKey: sealed } }), { deployment, signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE), chain: oneJob("x").chain })).toThrow(/seal secret/);
  });

  it("refuses what is not served on Stellar yet rather than half-honouring it", () => {
    const deps = { deployment, signer: keypairSigner(agentKey, STELLAR_TESTNET_PASSPHRASE), chain: oneJob("x").chain, anthropic: scriptedModel([]) };
    expect(() => hostStellarAgent(config({ tools: [{ name: "search", url: "https://mcp.example" }] }), deps)).toThrow(/MCP tools/);
    expect(() => hostStellarAgent(config({ delegation: { allow: ["did:aip:x"] } }), deps)).toThrow(/delegation/);
    expect(() =>
      hostStellarAgent(config({ delegation: { allow: ["did:aip:x"] }, capabilities: [{ ...config().capabilities[0], delegate: true }] }), deps),
    ).toThrow(/delegation/);
  });
});
