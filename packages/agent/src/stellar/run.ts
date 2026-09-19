/**
 * `square-agent`: the provider agent from a configuration (#29, D7 — the MVP).
 *
 *   SQUARE_PRIVATE_KEY=S… SQUARE_NETWORK=testnet square-agent
 *
 * Environment:
 *   SQUARE_PRIVATE_KEY   the agent's Stellar secret (S…, 56 characters)
 *   SQUARE_NETWORK       testnet (default) or local
 *   SQUARE_DEPLOYMENT    a deployment record; contracts/deployments/<network>.json by default
 *   RPC_URL              overrides the network's endpoint
 *   SQUARE_AGENT_HANDLER a module whose default export is the JobHandler;
 *                        without one the agent answers with the job's own
 *                        description, which delivers and settles but does no
 *                        work, and says so on every job
 *   SQUARE_POLL_MS       how long between passes (default 5000)
 *
 * The key is read from the environment and never written anywhere. Fee
 * sponsorship (#27) and a hosted deployment (#47) are phase 2: this pays its
 * own XLM fees from the account the key names.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { connectSquareClient, deploymentFromJson, keypairSigner, networkFor, type SquareDeployment } from "@squaresdk/core/stellar";
import { createProviderAgent, type JobHandler } from "./provider.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function loadDeployment(network: string): SquareDeployment {
  const file = process.env["SQUARE_DEPLOYMENT"] ?? resolve(process.cwd(), "contracts", "deployments", `${network}.json`);
  if (!existsSync(file)) {
    throw new Error(`no deployment record at ${file}; set SQUARE_DEPLOYMENT, or deploy first (contracts/script/deploy.sh)`);
  }
  return deploymentFromJson(JSON.parse(readFileSync(file, "utf8")));
}

async function loadHandler(): Promise<JobHandler> {
  const path = process.env["SQUARE_AGENT_HANDLER"];
  if (!path) {
    console.warn("SQUARE_AGENT_HANDLER is not set: every job is answered with its own description, which settles but does no work.");
    return (job) => job.description;
  }
  const module = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown };
  if (typeof module.default !== "function") throw new Error(`${path} has no default export that is a function`);
  return module.default as JobHandler;
}

async function main(): Promise<void> {
  const network = process.env["SQUARE_NETWORK"] ?? "testnet";
  const deployment = loadDeployment(network);
  const keypair = Keypair.fromSecret(required("SQUARE_PRIVATE_KEY"));
  const client = await connectSquareClient({
    deployment,
    rpc: process.env["RPC_URL"] ?? networkFor(deployment.network)?.rpcUrl,
    signer: keypairSigner(keypair, deployment.networkPassphrase),
  });

  const agent = createProviderAgent({
    client,
    handle: await loadHandler(),
    pollIntervalMs: Number(process.env["SQUARE_POLL_MS"] ?? 5_000),
    log: (line) => console.info(line),
  });

  const stopping = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.info(`\n${signal}: finishing the pass and stopping.`);
      stopping.abort();
    });
  }
  await agent.run({ signal: stopping.signal });
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
