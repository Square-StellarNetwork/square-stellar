#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ARC_TESTNET_CHAIN_ID,
  createScreenerClient,
  deploymentFor,
  deploymentFromJson,
  networkFor,
  type SquareDeployment,
} from "@squaresdk/core";
import { deploymentFromJson as stellarDeploymentFromJson, isStellarNetworkId, keypairSigner, networks as stellarNetworks, type SquareDeployment as StellarDeployment } from "@squaresdk/core/stellar";
import { describeDutyEvent, parsePolicy } from "@squaresdk/policy";
import { createLocalProver, fileDutyState, type LocalProver } from "@squaresdk/policy/node";
import { Keypair } from "@stellar/stellar-sdk";
import { createPublicClient, createWalletClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseHostedConfig, type HostedAgentConfig } from "./config.js";
import { hostAgent, sealContext, type ComplianceDeps } from "./host.js";
import { deriveSealKey, seal } from "./sealed.js";
import { hostStellarAgent } from "./stellar.js";

/**
 * `square-hosted <config.json>`: run the agent the configuration describes.
 * `square-hosted` with no path: the same, from the configuration in
 * SQUARE_HOSTED_CONFIG, for a host that has variables and no files to mount
 * (docs/deploy/railway.md); the policy and state files of a compliance block
 * are then relative to the working directory.
 * `square-hosted seal <agentId|name>`: seal an institution's API key, read
 * from stdin, for that agent's configuration (its ERC-8004 id, or on Stellar
 * its name).
 *
 * On Stellar (the MVP: `SQUARE_NETWORK=stellar:testnet` or `stellar:local`)
 * the host runs the configuration through `@squaresdk/agent/stellar`: it
 * watches the kernel for jobs created for its key, runs each capability's
 * instructions through the model on the job's description, submits,
 * finalizes and withdraws. No tools, delegation or compliance there yet.
 *
 *   SQUARE_NETWORK           stellar:testnet | stellar:local for the Stellar host; unset for an EVM chain
 *   SQUARE_SECRET_KEY        the Stellar key (S…) jobs are created for (required on Stellar)
 *   SQUARE_STATE_FILE        where the Stellar host keeps the jobs it has seen across restarts; <config>.provider.json
 *   SQUARE_START_LEDGER      the ledger the Stellar host starts looking for jobs from; the latest when unset
 *   SQUARE_POLL_MS           how often it looks; 10000
 *
 *   SQUARE_PRIVATE_KEY       the wallet that owns the config's agentId (required to run on an EVM chain)
 *   SQUARE_HOSTED_CONFIG     the configuration itself, as JSON, when no path is given
 *   SQUARE_CHAIN_ID          5042002 (Arc Testnet) by default; 31337 for anvil
 *   SQUARE_RPC_URL           the chain's endpoint; defaults to the network profile's
 *   SQUARE_DEPLOYMENT_FILE   a contracts/deployments/<chainId>.json, for a local stack
 *   SQUARE_SEAL_SECRET       what own-tier keys are sealed under (seal, and run with an own key)
 *   ANTHROPIC_API_KEY        the platform tier's key, read by the Anthropic SDK itself
 *   PORT, HOST               where the agent listens; 3000 and 0.0.0.0
 *   SQUARE_PROVER_ARTIFACTS  the directory holding payment.wasm, payment.zkey and payment_vk.json (a config with a compliance block)
 *
 * A config with a `compliance` block names the policy file (relative to the
 * config); the host proves with the circuit's files in SQUARE_PROVER_ARTIFACTS,
 * in this process, so the policy never leaves it (square#347), keeps a proof
 * bound to every job it delegates and releases each when its window closes
 * (square#335).
 *
 * A key in an environment variable is a key in the process table, the same
 * trade the CLI's unattended mode makes; an institution's own key never sits
 * in one, only sealed in its configuration.
 */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function chainFor(chainId: number, rpcUrl: string): Chain {
  let name = `chain ${chainId}`;
  let nativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 };
  try {
    const profile = networkFor(chainId);
    name = profile.name;
    nativeCurrency = profile.nativeCurrency;
  } catch {
    /* a chain without a profile: the endpoint was given, the deployment file gives the addresses */
  }
  return defineChain({ id: chainId, name, nativeCurrency, rpcUrls: { default: { http: [rpcUrl] } } });
}

function deploymentOf(chainId: number): SquareDeployment {
  const file = env("SQUARE_DEPLOYMENT_FILE");
  if (file === undefined) return deploymentFor(chainId);
  const deployment = deploymentFromJson(JSON.parse(readFileSync(file, "utf8")));
  if (deployment.chainId !== chainId) {
    throw new Error(`SQUARE_DEPLOYMENT_FILE ${file} is for chain ${deployment.chainId}, SQUARE_CHAIN_ID is ${chainId}`);
  }
  return deployment;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function sealCommand(who: string | undefined): Promise<void> {
  if (who === undefined || who === "") throw new Error("usage: square-hosted seal <agentId|name>  (the key on stdin)");
  const secret = env("SQUARE_SEAL_SECRET");
  if (secret === undefined) throw new Error("set SQUARE_SEAL_SECRET to seal a key");
  const key = await readStdin();
  if (key === "") throw new Error("nothing on stdin to seal");
  const context = /^\d+$/.test(who) ? sealContext({ agentId: who }) : sealContext({ name: who });
  process.stdout.write(seal(key, deriveSealKey(secret), context) + "\n");
}

function stellarDeploymentOf(network: string): StellarDeployment {
  const file = env("SQUARE_DEPLOYMENT_FILE");
  if (file === undefined) throw new Error(`SQUARE_DEPLOYMENT_FILE is required on ${network}: the contracts/deployments/<network>.json the deploy script wrote`);
  const deployment = stellarDeploymentFromJson(JSON.parse(readFileSync(file, "utf8")));
  if (deployment.network !== network) throw new Error(`SQUARE_DEPLOYMENT_FILE ${file} is for ${deployment.network}, SQUARE_NETWORK is ${network}`);
  return deployment;
}

async function runStellar(network: string, config: HostedAgentConfig, files: { dir: string; stateDefault: string }): Promise<void> {
  if (!isStellarNetworkId(network)) throw new Error(`SQUARE_NETWORK ${network} is not a Stellar network id (stellar:testnet, stellar:local)`);
  const deployment = stellarDeploymentOf(network);
  const secret = env("SQUARE_SECRET_KEY");
  if (secret === undefined) throw new Error("SQUARE_SECRET_KEY is the Stellar key jobs are created for; it is required");
  const rpcUrl = env("SQUARE_RPC_URL") ?? stellarNetworks[network]?.rpcUrl;
  if (rpcUrl === undefined) throw new Error(`no RPC endpoint is known for ${network}; set SQUARE_RPC_URL`);
  const startLedger = env("SQUARE_START_LEDGER");
  const pollMs = env("SQUARE_POLL_MS");
  const hosted = hostStellarAgent(config, {
    deployment,
    signer: keypairSigner(Keypair.fromSecret(secret), deployment.networkPassphrase),
    rpcUrl,
    sealSecret: env("SQUARE_SEAL_SECRET"),
    stateFile: env("SQUARE_STATE_FILE") ?? files.stateDefault,
    startLedger: startLedger !== undefined ? Number(startLedger) : undefined,
    pollMs: pollMs !== undefined ? Number(pollMs) : undefined,
    onRun: ({ jobId, capability, outcome }) => console.error(`[square-hosted] ${capability} job ${jobId}: ${outcome.turns} turn(s), ${outcome.usage.inputTokens}/${outcome.usage.outputTokens} tokens`),
    onEvent: (event) => {
      const job = "jobId" in event && event.jobId !== undefined ? ` job ${event.jobId}` : "";
      const detail = event.type === "error" ? ` ${event.step}: ${event.error instanceof Error ? event.error.message : String(event.error)}` : event.type === "unserviceable" ? `: ${event.reason}` : "";
      console.error(`[square-hosted] ${event.type}${job}${detail}`);
    },
  });
  await hosted.agent.client!.assertNetwork();
  const port = Number(env("PORT") ?? 3000);
  const listening = await hosted.agent.listen(port, env("HOST") ?? "0.0.0.0");
  console.error(
    `[square-hosted] ${config.name} (${hosted.agent.account}) on ${network}, kernel ${deployment.squareJob}, listening at ${listening.url}: ` +
      `${config.capabilities.map((c) => c.id).join(", ")}; ${config.provider.tier} key`,
  );
  const stop = async () => {
    await listening.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

async function runCommand(path: string | undefined): Promise<void> {
  const inline = env("SQUARE_HOSTED_CONFIG");
  if (path === undefined && inline === undefined) {
    throw new Error("usage: square-hosted <config.json> | square-hosted seal <agentId|name>; or the configuration as JSON in SQUARE_HOSTED_CONFIG");
  }
  const config = parseHostedConfig(JSON.parse(path !== undefined ? readFileSync(path, "utf8") : (inline as string)));
  // Where a compliance block's policy and state files are: beside the
  // configuration file, or in the working directory for one from the environment.
  const files = path !== undefined ? { dir: dirname(path), stateDefault: `${path}.duty.json` } : { dir: process.cwd(), stateDefault: resolve(process.cwd(), "square-hosted.duty.json") };

  const network = env("SQUARE_NETWORK");
  if (network !== undefined && network.startsWith("stellar:")) {
    const stateDefault = path !== undefined ? `${path}.provider.json` : resolve(process.cwd(), "square-hosted.provider.json");
    await runStellar(network, config, { dir: files.dir, stateDefault });
    return;
  }

  const chainId = Number(env("SQUARE_CHAIN_ID") ?? ARC_TESTNET_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`SQUARE_CHAIN_ID must be a positive integer, got ${env("SQUARE_CHAIN_ID")}`);
  const deployment = deploymentOf(chainId);
  let rpcUrl = env("SQUARE_RPC_URL");
  if (rpcUrl === undefined) {
    try {
      rpcUrl = networkFor(chainId).rpcUrl;
    } catch {
      throw new Error(`no RPC endpoint is known for chain ${chainId}; set SQUARE_RPC_URL`);
    }
  }
  const key = env("SQUARE_PRIVATE_KEY");
  if (key === undefined) throw new Error("SQUARE_PRIVATE_KEY is the wallet that owns the agent; it is required");
  const chain = chainFor(chainId, rpcUrl);
  const account = privateKeyToAccount(key as `0x${string}`);
  const pollingInterval = 1_000;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval }) as PublicClient;
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl), pollingInterval });

  const compliance = complianceOf(config, files);
  const screenerUrl = config.delegation?.screenerUrl;
  const hosted = await hostAgent(config, {
    walletClient,
    publicClient,
    deployment,
    rpcUrl,
    sealSecret: env("SQUARE_SEAL_SECRET"),
    ...(screenerUrl !== undefined ? { screener: createScreenerClient({ url: screenerUrl }) } : {}),
    onRun: ({ taskId, capability, outcome }) =>
      console.error(`[square-hosted] ${capability} task ${taskId}: ${outcome.turns} turn(s), ${outcome.toolCalls.length} tool call(s), ${outcome.usage.inputTokens}/${outcome.usage.outputTokens} tokens`),
    ...(compliance ? { compliance } : {}),
  });
  await hosted.agent.client.assertChain();
  const port = Number(env("PORT") ?? 3000);
  const listening = await hosted.agent.listen(port, env("HOST") ?? "0.0.0.0");
  console.error(
    `[square-hosted] ${config.name} (${hosted.agent.did}) listening at ${listening.url}: ` +
      `${config.capabilities.map((c) => c.id).join(", ")}; ${config.provider.tier} key; ` +
      `${hosted.tools ? `${(await hosted.tools.tools()).length} MCP tool(s)` : "no MCP tools"}; ` +
      `${config.delegation ? `may hire ${config.delegation.allow.join(", ")}` : "no delegation"}` +
      `${compliance ? `; proving delegated releases under policy ${compliance.policy.policy_id} in this process, from ${compliance.prover.artifacts}` : ""}` +
      `${screenerUrl !== undefined ? `; screening delegated parties at ${screenerUrl}` : ""}`,
  );
  const stop = async () => {
    await listening.close();
    await hosted.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

/** The config's compliance block as the host's deps: the policy read from beside the config, the proof made in this process. */
function complianceOf(config: HostedAgentConfig, files: { dir: string; stateDefault: string }): (ComplianceDeps & { prover: LocalProver }) | undefined {
  if (!config.compliance) return undefined;
  const artifacts = env("SQUARE_PROVER_ARTIFACTS");
  if (artifacts === undefined) {
    throw new Error("a compliance block needs SQUARE_PROVER_ARTIFACTS, the directory holding payment.wasm, payment.zkey and payment_vk.json: the proof is made in this process, so the policy never leaves it");
  }
  const file = resolve(files.dir, config.compliance.policyFile);
  const policy = parsePolicy(JSON.parse(readFileSync(file, "utf8")));
  const stateFile = config.compliance.stateFile === undefined ? files.stateDefault : config.compliance.stateFile === false ? undefined : resolve(files.dir, config.compliance.stateFile);
  return {
    policy,
    prover: createLocalProver({ artifacts }),
    intervalMs: config.compliance.intervalMs,
    ...(stateFile !== undefined ? { state: fileDutyState(stateFile) } : {}),
    onEvent: (event) => console.error(`[square-hosted] compliance: ${describeDutyEvent(event)}`),
  };
}

const [command, argument] = process.argv.slice(2);
(command === "seal" ? sealCommand(argument) : runCommand(command)).catch((error: unknown) => {
  console.error(`[square-hosted] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
