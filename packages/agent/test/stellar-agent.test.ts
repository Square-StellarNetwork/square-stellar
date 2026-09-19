import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createStellarAgent } from "../src/stellar/index.js";
import { FakeKernel } from "./stellar-fake-kernel.js";

const AGENT = Keypair.random().publicKey();
const CLIENT = Keypair.random().publicKey();

describe("createStellarAgent", () => {
  it("serves its capabilities, its jobs and the deliverable behind the hash, and runs the loop", async () => {
    const kernel = new FakeKernel();
    const agent = createStellarAgent({ name: "Atlas", description: "summaries", chain: kernel.chainFor(AGENT), startLedger: 1 })
      .capability("summarise", { description: "a summary", price: "2.5", handler: async ({ input }) => `summary of ${input}` })
      .capability("translate", { description: "into French", handler: async ({ input }) => `fr: ${input}` });
    expect(agent.account).toBe(AGENT);
    expect(agent.capabilities()).toEqual([
      { id: "summarise", description: "a summary", price: "2.5" },
      { id: "translate", description: "into French" },
    ]);
    expect(() => agent.capability("Bad Id", { description: "", handler: async () => "" })).toThrow(/capability id/);

    const get = async (path: string) => {
      const response = await agent.app.fetch(new Request(`http://agent${path}`));
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    expect((await get("/health")).body).toMatchObject({ name: "Atlas", account: AGENT, tracking: 0 });
    expect((await get("/capabilities")).body).toEqual({ capabilities: agent.capabilities() });
    expect(await get("/jobs/1/deliverable")).toMatchObject({ status: 404 });
    expect(await get("/jobs/x")).toMatchObject({ status: 404 });

    const job = kernel.create(CLIENT, AGENT, "summarise: the report");
    kernel.fund(job, 25_000_000n);
    await agent.provider.tick();
    expect((await get("/health")).body).toMatchObject({ tracking: 1 });
    const listed = (await get("/jobs")).body as { jobs: Array<Record<string, unknown>> };
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]).toMatchObject({ jobId: "1", status: "Submitted", capability: "summarise", delivered: true });
    expect(listed.jobs[0]).not.toHaveProperty("content");
    const delivered = await get("/jobs/1/deliverable");
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ jobId: "1", capability: "summarise", content: "summary of the report", submittedIn: "submit-1" });
    expect(delivered.body["deliverable"]).toBe(Buffer.from(kernel.get(job).deliverable!).toString("hex"));
    expect((await get("/jobs/1")).body).toMatchObject({ jobId: "1", delivered: true });
  });

  it("needs a client or a deployment and a signer when no chain is given", () => {
    expect(() => createStellarAgent({ name: "x", description: "y" })).toThrow(/needs a client/);
  });

  it("listens, runs the loop on a timer, and closes", async () => {
    const kernel = new FakeKernel();
    const agent = createStellarAgent({ name: "Atlas", description: "", chain: kernel.chainFor(AGENT), startLedger: 1, pollMs: 5 }).capability("echo", {
      description: "",
      handler: async ({ input }) => input,
    });
    const job = kernel.create(CLIENT, AGENT, "hello");
    kernel.fund(job, 1n);
    const listening = await agent.listen(0, "127.0.0.1");
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const response = await fetch(`${listening.url}/jobs/1/deliverable`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { content: string }).content).toBe("hello");
    } finally {
      await listening.close();
    }
  });
});
