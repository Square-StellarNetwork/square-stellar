/**
 * The MVP lifecycle on Stellar (#45, H3): one job, end to end, against a
 * deployed kernel, with every transaction recorded.
 *
 *   create → price → fund → submit → (the window) → finalize → withdraw
 *
 * plus the one refusal that proves the window is real: a finalize sent while
 * it is still open, which the kernel refuses in simulation so nothing is sent.
 *
 * The five settlement paths, real USDC and the keeper are phase 2; this is
 * the path the MVP milestone asks for, and its report is the evidence #45
 * closes on. Run it after `contracts/script/deploy-testnet.sh` has written
 * `contracts/deployments/testnet.json`, and after `npm run build` here.
 *
 *   SQUARE_NETWORK=testnet npm run lifecycle:stellar
 *
 * Environment:
 *   SQUARE_NETWORK              testnet (default) or local
 *   RPC_URL                     overrides the network's endpoint
 *   LIFECYCLE_CLIENT_SECRET     S…; a Friendbot account when absent
 *   LIFECYCLE_PROVIDER_SECRET   S…; a Friendbot account when absent
 *   LIFECYCLE_BUDGET            the job's price in stroops (default 10 XLM)
 *   LIFECYCLE_FINALIZER         self (default) cranks it; external waits for
 *                               someone else to and records their transaction
 *   LIFECYCLE_OUT               where the report goes (default docs/deploy)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  connectSquareClient,
  deploymentFromJson,
  formatXlm,
  JobStatus,
  JOB_STATUS_NAMES,
  kernelEvent,
  keypairSigner,
  networkFor,
  type SquareClient,
  type SquareDeployment,
} from "../dist/stellar/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const networkName = process.env["SQUARE_NETWORK"] ?? "testnet";
const budget = BigInt(process.env["LIFECYCLE_BUDGET"] ?? 100_000_000); // 10 XLM
const finalizer = process.env["LIFECYCLE_FINALIZER"] ?? "self";
const outDir = process.env["LIFECYCLE_OUT"] ?? join(repoRoot, "docs", "deploy");

interface Row {
  step: string;
  hash?: string;
  ledger?: number;
  feeStroops?: bigint;
  note?: string;
}

const rows: Row[] = [];

function record(step: string, result: { hash: string; ledger: number; feeCharged: bigint }): void {
  rows.push({ step, hash: result.hash, ledger: result.ledger, feeStroops: result.feeCharged });
  console.info(`${step.padEnd(28)} ${result.hash} ledger ${result.ledger} fee ${formatXlm(result.feeCharged)} XLM`);
}

function note(step: string, text: string): void {
  rows.push({ step, note: text });
  console.info(`${step.padEnd(28)} ${text}`);
}

function loadDeployment(): SquareDeployment {
  const file = join(repoRoot, "contracts", "deployments", `${networkName}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `no deployment record at contracts/deployments/${networkName}.json.\n` +
        `Deploy first: contracts/script/deploy-${networkName}.sh`,
    );
  }
  return deploymentFromJson(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * An account to run as. A secret in the environment is used as it is, so a
 * run can be repeated from the same accounts and their history read; without
 * one the network's Friendbot funds a fresh keypair, which is what a first
 * run on testnet does.
 */
async function actor(role: string, secret: string | undefined, friendbotUrl: string | undefined): Promise<Keypair> {
  if (secret) {
    const keypair = Keypair.fromSecret(secret);
    console.info(`${role.padEnd(10)} ${keypair.publicKey()} (from the environment)`);
    return keypair;
  }
  if (!friendbotUrl) throw new Error(`${networkName} has no Friendbot; set LIFECYCLE_${role.toUpperCase()}_SECRET`);
  const keypair = Keypair.random();
  const funded = await fetch(`${friendbotUrl}/?addr=${keypair.publicKey()}`);
  if (!funded.ok) throw new Error(`Friendbot refused ${keypair.publicKey()}: ${funded.status}`);
  console.info(`${role.padEnd(10)} ${keypair.publicKey()} (funded by Friendbot)`);
  return keypair;
}

/** Wait until the ledger's clock is past `until`, which the kernel measures the window against. */
async function waitPast(until: bigint): Promise<void> {
  for (;;) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now > until + 5n) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

/**
 * The finalize transaction when somebody else sent it: the kernel's
 * `finalized` event for this job, found from the ledger the submission
 * landed in. Used by LIFECYCLE_FINALIZER=external, where the point of the
 * run is that the crank was turned by a party the runner does not control.
 */
async function externalFinalize(client: SquareClient, jobId: bigint, fromLedger: number): Promise<Row> {
  for (;;) {
    const job = await client.getJob(jobId);
    if (job.status === JobStatus.Completed) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const page = await client.server.getEvents({
    startLedger: fromLedger,
    filters: [{ type: "contract", contractIds: [client.deployment.squareJob] }],
  });
  for (const raw of page.events ?? []) {
    const decoded = client.decodeEvents([raw]);
    const finalized = kernelEvent(decoded, "finalized");
    if (finalized?.jobId !== jobId) continue;
    const tx = await client.getTransaction(raw.txHash);
    return { step: "finalize (external)", hash: raw.txHash, ledger: raw.ledger, feeStroops: tx?.feeCharged };
  }
  return { step: "finalize (external)", note: "the job completed, but its event was not in the page read back" };
}

async function main(): Promise<void> {
  const deployment = loadDeployment();
  const profile = networkFor(deployment.network);
  const rpcUrl = process.env["RPC_URL"] ?? profile?.rpcUrl;

  console.info(`kernel     ${deployment.squareJob} on ${deployment.network}`);
  console.info(`token      ${deployment.token.code} ${deployment.token.contractId}`);
  console.info(`rpc        ${rpcUrl}`);

  const clientKey = await actor("client", process.env["LIFECYCLE_CLIENT_SECRET"], profile?.friendbotUrl);
  const providerKey = await actor("provider", process.env["LIFECYCLE_PROVIDER_SECRET"], profile?.friendbotUrl);

  const signerFor = (keypair: Keypair) => keypairSigner(keypair, deployment.networkPassphrase);
  const client = await connectSquareClient({ deployment, rpc: rpcUrl, signer: signerFor(clientKey) });
  const provider = await connectSquareClient({ deployment, rpc: rpcUrl, signer: signerFor(providerKey) });

  const config = await client.kernelConfig();
  console.info(`window     ${config.challengeWindow}s, platform fee ${config.platformFeeBps} bps\n`);

  // The job has to outlive the window it will wait out, plus room for the
  // run itself; a job that expires first can no longer be delivered.
  const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + config.challengeWindow + 3600n;
  const created = await client.createJob({
    provider: providerKey.publicKey(),
    expiredAt,
    description: "lifecycle: the MVP path on Stellar",
  });
  const jobId = created.result;
  record(`createJob (id ${jobId})`, created);

  // The price is the provider's to set; the client funds what it was quoted
  // and the amount it passes has to match, so a repriced job cannot be
  // funded by surprise.
  record("setBudget", await provider.setBudget(jobId, budget));
  record("fund", await client.fund(jobId, budget));

  const submitted = await provider.submit(jobId, "the deliverable of the MVP lifecycle run");
  record("submit", submitted);
  const submittedEvent = kernelEvent(submitted.events, "submitted");
  const job = await client.getJob(jobId);
  if (job.finalizeAfter === undefined) throw new Error("the job carries no finalizeAfter after a submission");

  // The refusal that proves the window: inside it the kernel answers
  // WindowOpen in simulation, so nothing is signed and nothing is sent.
  if (config.challengeWindow > 0n) {
    const early = await client.finalize(jobId).then(() => undefined, (error: unknown) => error);
    const name = (early as { errorName?: string } | undefined)?.errorName;
    if (name !== "WindowOpen") throw new Error(`finalize inside the window answered ${name ?? "nothing"}, expected WindowOpen`);
    note("finalize (inside the window)", "refused in simulation with WindowOpen; nothing was sent");
  }

  await waitPast(job.finalizeAfter);

  if (finalizer === "external") {
    const row = await externalFinalize(client, jobId, submitted.ledger);
    rows.push(row);
    console.info(`${row.step.padEnd(28)} ${row.hash ?? row.note}`);
  } else {
    // Permissionless: the client cranks it here because the MVP has no
    // keeper (keeper_evaluator is phase 2), not because it is the client's.
    record("finalize (permissionless)", await client.finalize(jobId));
  }

  const settled = await client.getJob(jobId);
  if (settled.status !== JobStatus.Completed) throw new Error(`the job is ${JOB_STATUS_NAMES[settled.status]}, not Completed`);

  // Pull payment: nothing was pushed, the provider takes its payout home.
  const payout = await provider.withdrawable();
  record(`withdraw (${formatXlm(payout)} ${deployment.token.code})`, await provider.withdraw(payout));

  writeReport({ deployment, rpcUrl, jobId, budget, payout, clientKey, providerKey, config, submittedEvent });
}

function writeReport(context: {
  deployment: SquareDeployment;
  rpcUrl: string | undefined;
  jobId: bigint;
  budget: bigint;
  payout: bigint;
  clientKey: Keypair;
  providerKey: Keypair;
  config: { challengeWindow: bigint; platformFeeBps: number };
  submittedEvent: unknown;
}): void {
  const { deployment, rpcUrl, jobId, budget, payout, clientKey, providerKey, config } = context;
  const profile = networkFor(deployment.network);
  const explorer = profile?.explorerUrl;
  const ranAt = new Date().toISOString();
  const day = ranAt.slice(0, 10);
  const link = (hash: string) => (explorer ? `[${hash.slice(0, 8)}…](${explorer}/tx/${hash})` : `\`${hash.slice(0, 8)}…\``);
  const totalFees = rows.reduce((sum, row) => sum + (row.feeStroops ?? 0n), 0n);

  const lines = [
    `# MVP lifecycle run on ${deployment.network}`,
    "",
    `Run at ${ranAt} against ${rpcUrl ?? "the network's endpoint"}. One job, the MVP path:`,
    `create, price, fund, submit, the window, finalize, withdraw. The five settlement`,
    `paths, real USDC and the keeper are phase 2.`,
    "",
    "| | |",
    "|---|---|",
    `| Kernel | ${explorer ? `[${deployment.squareJob}](${explorer}/contract/${deployment.squareJob})` : `\`${deployment.squareJob}\``} |`,
    `| Payment token | ${deployment.token.code}, \`${deployment.token.contractId}\` |`,
    `| Challenge window | ${config.challengeWindow} s |`,
    `| Platform fee | ${config.platformFeeBps} bps |`,
    `| Job | ${jobId} |`,
    `| Client | \`${clientKey.publicKey()}\` |`,
    `| Provider | \`${providerKey.publicKey()}\` |`,
    `| Budget | ${formatXlm(budget)} ${deployment.token.code} |`,
    `| Payout | ${formatXlm(payout)} ${deployment.token.code} |`,
    `| Fee kept | ${formatXlm(budget - payout)} ${deployment.token.code} |`,
    "",
    "| Step | Transaction | Ledger | Fee charged |",
    "|---|---|---|---|",
    ...rows.map((row) =>
      row.hash
        ? `| ${row.step} | ${link(row.hash)} | ${row.ledger} | ${formatXlm(row.feeStroops ?? 0n)} XLM |`
        : `| ${row.step} | ${row.note ?? ""} | | |`,
    ),
    "",
    `Resource and inclusion fees for the run: ${formatXlm(totalFees)} XLM over ${rows.filter((r) => r.hash).length} transactions.`,
    "",
    "The fee column is `feeCharged` from each transaction's own result, which is the",
    "inclusion fee plus the resource fee with refunds applied: what the account actually",
    "paid, not what was bid.",
    "",
  ];

  mkdirSync(outDir, { recursive: true });
  const dated = join(outDir, `lifecycle-${networkName}-${day}.md`);
  const latest = join(outDir, `lifecycle-${networkName}.md`);
  writeFileSync(dated, lines.join("\n"));
  writeFileSync(
    latest,
    [
      lines[0],
      "",
      `This file always holds the latest run and is rewritten every time the runner is used.`,
      `The dated record of this run is [lifecycle-${networkName}-${day}.md](./lifecycle-${networkName}-${day}.md),`,
      `which nothing overwrites, and that is the file a document quoting a figure should link.`,
      ...lines.slice(1),
    ].join("\n"),
  );
  console.info(`\nWrote ${dated}\n      ${latest}`);
}

main().catch((error: unknown) => {
  console.error(`\nerror: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
