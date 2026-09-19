import { Keypair } from "@stellar/stellar-sdk";
import { connectSquareClient, deliverableHash, JobStatus, keypairSigner, nativeToken, networkFor, type SquareDeployment } from "@squaresdk/core/stellar";
import { describe, expect, it } from "vitest";
import { createStellarAgent, type ProviderEvent } from "../src/stellar/index.js";

/**
 * The agent against Stellar testnet, with `STELLAR_LIVE=1` and
 * `STELLAR_KERNEL=C…` naming a kernel deployed with native XLM and a short
 * challenge window: a client made for the run creates and funds a job for
 * the agent's key, the agent finds it, works it, submits, finalizes after the
 * window, withdraws, and serves the deliverable behind the hash on chain.
 */
const live = process.env["STELLAR_LIVE"] === "1";
const kernel = process.env["STELLAR_KERNEL"];
const testnet = networkFor("stellar:testnet");

async function friendbot(account: string): Promise<void> {
  const funded = await fetch(`${testnet.friendbotUrl}/?addr=${account}`);
  if (!funded.ok) throw new Error(`friendbot refused ${account}: ${funded.status}`);
}

describe.skipIf(!live || !kernel)("the agent on Stellar testnet", () => {
  const deployment: SquareDeployment = {
    network: "stellar:testnet",
    networkPassphrase: testnet.networkPassphrase,
    squareJob: kernel ?? "",
    token: nativeToken(testnet.networkPassphrase),
  };

  it("is hired, works, delivers, is paid", async () => {
    const agentKey = Keypair.random();
    const clientKey = Keypair.random();
    await Promise.all([friendbot(agentKey.publicKey()), friendbot(clientKey.publicKey())]);
    const client = await connectSquareClient({ deployment, signer: keypairSigner(clientKey, testnet.networkPassphrase) });
    const startLedger = await client.latestLedger();

    const events: ProviderEvent[] = [];
    const agent = createStellarAgent({
      name: "Atlas",
      description: "summaries, on testnet",
      deployment,
      signer: keypairSigner(agentKey, testnet.networkPassphrase),
      startLedger,
      pollMs: 4_000,
      onEvent: (event) => {
        events.push(event);
        console.info(`[agent] ${event.type}${"jobId" in event && event.jobId !== undefined ? ` job ${event.jobId}` : ""}${event.type === "error" ? `: ${String((event.error as Error).message ?? event.error)}` : ""}`);
      },
    }).capability("summarise", { description: "a summary", handler: async ({ input }) => `SUMMARY: ${input.toUpperCase()}` });
    const listening = await agent.listen(0, "127.0.0.1");
    try {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const created = await client.createJob({ provider: agentKey.publicKey(), expiredAt: now + 3600n, description: "summarise: the quarterly report" });
      const jobId = created.result;
      await client.setBudget(jobId, 20_000_000n);
      await client.fund(jobId, 20_000_000n);
      console.info(`[client] job ${jobId} funded with 2 XLM for ${agentKey.publicKey()}`);

      const until = async (predicate: () => boolean, ms: number) => {
        const deadline = Date.now() + ms;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error(`timed out waiting; events so far: ${events.map((e) => e.type).join(", ")}`);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      };
      await until(() => events.some((e) => e.type === "submitted"), 90_000);
      const onChain = await client.getJob(jobId);
      expect(onChain.status).toBe(JobStatus.Submitted);
      const response = await fetch(`${listening.url}/jobs/${jobId}/deliverable`);
      const delivered = (await response.json()) as { content: string; deliverable: string };
      expect(delivered.content).toBe("SUMMARY: THE QUARTERLY REPORT");
      expect(Buffer.from(deliverableHash(delivered.content)).toString("hex")).toBe(delivered.deliverable);
      expect(Buffer.from(onChain.deliverable!).toString("hex")).toBe(delivered.deliverable);

      await until(() => events.some((e) => e.type === "withdrawn"), 180_000);
      expect((await client.getJob(jobId)).status).toBe(JobStatus.Completed);
      const withdrawn = events.find((e) => e.type === "withdrawn");
      expect(withdrawn).toMatchObject({ amount: 20_000_000n - (20_000_000n * BigInt(onChain.platformFeeBps)) / 10_000n });
      expect(await client.withdrawable(agentKey.publicKey())).toBe(0n);
      expect(await client.tokenBalance(agentKey.publicKey())).toBeGreaterThan(10_000n * 10_000_000n);
      console.info(`[agent] paid: ${events.filter((e) => e.type === "withdrawn").map((e) => (e.type === "withdrawn" ? e.hash : "")).join()} ${testnet.explorerUrl}/contract/${kernel}`);
    } finally {
      await listening.close();
    }
  }, 300_000);
});
