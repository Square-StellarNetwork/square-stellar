/**
 * The TRY rail, end to end (#58): lira in through an anchor, a job funded
 * with what it paid, the agent paid out of it.
 *
 *   SEP-10 sign-in → SEP-38 quote → SEP-6 deposit → (the anchor pays USDC)
 *   → create → price → fund → submit → the window → finalize → withdraw
 *
 * It is the companion to `lifecycle-stellar.ts`, which runs the same
 * settlement on the XLM kernel; this one runs it on the kernel deployed
 * against Circle's testnet USDC, which is what the anchor pays. Everything
 * here is a real request to a real service: the anchor signs a real SEP-10
 * challenge and pays real testnet USDC. What is simulated is its bank leg —
 * no lira moves anywhere — and the report says so.
 *
 *   SQUARE_NETWORK=testnet-usdc npm run try-rail
 *
 * Environment:
 *   SQUARE_NETWORK        the record under contracts/deployments (testnet-usdc)
 *   STELLAR_ANCHOR        the anchor's home domain
 *   TRY_AMOUNT            how much fiat to deposit (default 250)
 *   TRY_BUDGET            the job's budget in USDC (default 1)
 *   ANCHOR_WAIT_MS        how long to wait for the anchor's payout (default 8 min)
 *   LIFECYCLE_OUT         where the report goes (default docs/deploy)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import {
  authenticateWithAnchor,
  connectSquareClient,
  deploymentFromJson,
  discoverAnchor,
  formatUnits,
  keypairSigner,
  networkFor,
  quotePrice,
  Sep6Client,
  sep38Asset,
  type SquareClient,
  type SquareDeployment,
} from "../dist/stellar/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const networkName = process.env["SQUARE_NETWORK"] ?? "testnet-usdc";
const anchorDomain = process.env["STELLAR_ANCHOR"] ?? "tr-mock-anchor.fly.dev";
const fiatAmount = process.env["TRY_AMOUNT"] ?? "250";
const budget = BigInt(process.env["TRY_BUDGET"] ?? 1) * 10_000_000n;
const anchorWaitMs = Number(process.env["ANCHOR_WAIT_MS"] ?? 8 * 60_000);
const outDir = process.env["LIFECYCLE_OUT"] ?? join(repoRoot, "docs", "deploy");

interface Row {
  step: string;
  detail: string;
  hash?: string;
}
const rows: Row[] = [];

function note(step: string, detail: string, hash?: string): void {
  rows.push(hash === undefined ? { step, detail } : { step, detail, hash });
  console.info(`${step.padEnd(26)} ${detail}${hash === undefined ? "" : ` ${hash}`}`);
}

function loadDeployment(): SquareDeployment {
  const file = join(repoRoot, "contracts", "deployments", `${networkName}.json`);
  if (!existsSync(file)) throw new Error(`no record at contracts/deployments/${networkName}.json`);
  return deploymentFromJson(JSON.parse(readFileSync(file, "utf8")));
}

async function friendbot(account: string, url: string | undefined): Promise<void> {
  if (url === undefined) throw new Error("this network has no Friendbot");
  const response = await fetch(`${url}/?addr=${account}`);
  if (!response.ok && response.status !== 400) throw new Error(`Friendbot answered ${response.status} for ${account}`);
}

/** `trust` on the asset's own SAC: the account's opt-in, as one signed invocation. */
async function openTrustline(client: SquareClient, address: string, token: string): Promise<string> {
  const result = await client.write<void>({
    contract: { id: token, name: "usdc" },
    method: "trust",
    args: [nativeToScVal(address, { type: "address" })],
    parse: () => undefined,
  });
  return result.hash;
}

async function usdcBalance(client: SquareClient, address: string, token: string): Promise<bigint> {
  try {
    return await client.read<bigint>({
      contract: { id: token, name: "usdc" },
      method: "balance",
      args: [nativeToScVal(address, { type: "address" })],
      parse: (value) => scValToNative(value) as bigint,
    });
  } catch {
    return 0n;
  }
}

async function main(): Promise<void> {
  const deployment = loadDeployment();
  const profile = networkFor(deployment.network);
  const token = deployment.token.contractId;

  console.info(`kernel     ${deployment.squareJob} on ${deployment.network}`);
  console.info(`token      ${deployment.token.code} ${token}`);
  console.info(`anchor     ${anchorDomain} (its bank leg is simulated; no ${"TRY"} moves)\n`);

  const clientKey = Keypair.random();
  const providerKey = Keypair.random();
  await friendbot(clientKey.publicKey(), profile.friendbotUrl);
  await friendbot(providerKey.publicKey(), profile.friendbotUrl);
  note("accounts", `client ${clientKey.publicKey()}, provider ${providerKey.publicKey()} (Friendbot)`);

  const client = await connectSquareClient({ deployment, signer: keypairSigner(clientKey, deployment.networkPassphrase) });
  const provider = await connectSquareClient({ deployment, signer: keypairSigner(providerKey, deployment.networkPassphrase) });

  note("trustline (client)", "accepting " + deployment.token.code, await openTrustline(client, clientKey.publicKey(), token));
  note("trustline (provider)", "accepting " + deployment.token.code, await openTrustline(provider, providerKey.publicKey(), token));

  // ---- the fiat leg ------------------------------------------------------
  const anchor = await discoverAnchor(anchorDomain, { expectedNetwork: deployment.networkPassphrase });
  const currency = anchor.currencies.find((entry) => entry.code === deployment.token.code) ?? anchor.currencies[0];
  if (currency === undefined) throw new Error(`${anchorDomain} lists no currency`);
  const fiat = currency.anchorAsset ?? "TRY";
  const session = await authenticateWithAnchor(anchor, keypairSigner(clientKey, deployment.networkPassphrase));
  note("SEP-10", `signed in as ${session.account}`);

  try {
    const quote = await quotePrice(session, {
      sellAsset: sep38Asset.fiat(fiat),
      buyAsset: currency.issuer === undefined ? sep38Asset.fiat(currency.code) : sep38Asset.stellar(currency.code, currency.issuer),
      sellAmount: fiatAmount,
    });
    note("SEP-38", `${fiatAmount} ${fiat} → ${quote.buyAmount} ${currency.code} at ${quote.price}`);
  } catch (error) {
    note("SEP-38", `no quote: ${(error as Error).message}`);
  }

  const sep6 = new Sep6Client(session);
  const deposit = await sep6.deposit({ assetCode: currency.code, amount: fiatAmount, type: "bank_account" });
  note("SEP-6 deposit", `${fiatAmount} ${fiat}, transaction ${deposit.id ?? "(none)"}`);

  const before = await usdcBalance(client, clientKey.publicKey(), token);

  // The anchor waits for the bank transfer, which on a sandbox is a button on
  // its own page. A person clicks it; this stands in for that, and nothing
  // else in the run differs from a production anchor where a real transfer
  // arrives instead.
  const opened = deposit.id === undefined ? null : await sep6.transaction(deposit.id);
  if (opened?.moreInfoUrl?.includes("/sep6/tx/")) {
    const simulated = await fetch(`${opened.moreInfoUrl.replace(/\/$/, "")}/simulate-bank-transfer`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _: "1", amount: fiatAmount }).toString(),
      redirect: "manual",
    });
    note("the bank leg", `simulated on the anchor's own page (${simulated.status})`);
  } else if (opened !== null) {
    note("the bank leg", `waiting for a real transfer; the anchor offers no page to simulate one (${opened.status})`);
  }

  if (deposit.id !== undefined) {
    const settled = await sep6
      .follow(deposit.id, { intervalMs: 5_000, timeoutMs: anchorWaitMs, onStatus: (t) => console.info(`  anchor: ${t.status}${t.message ? ` — ${t.message}` : ""}`) })
      .catch((error: Error) => {
        note("SEP-6 follow", `still pending after ${Math.round(anchorWaitMs / 1000)} s: ${error.message}`);
        return null;
      });
    if (settled !== null) note("SEP-6 settled", `${settled.status}, ${settled.amountOut ?? "?"} ${currency.code} out`, settled.stellarTransactionId);
  }

  const paid = await usdcBalance(client, clientKey.publicKey(), token);
  note("balance", `${formatUnits(before, 7)} → ${formatUnits(paid, 7)} ${currency.code}`);
  if (paid < budget) {
    note("stopped", `the anchor has not paid enough to fund a ${formatUnits(budget, 7)} ${currency.code} job yet; the settlement leg is not run`);
    write(rows, deployment, false);
    return;
  }

  // ---- the settlement leg, funded with what the anchor paid --------------
  const created = await client.createJob({
    provider: providerKey.publicKey(),
    expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    description: "summarise: the quarterly report",
  });
  const jobId = created.result;
  note("create_job", `job ${jobId}`, created.hash);

  note("set_budget", `${formatUnits(budget, 7)} ${currency.code}`, (await provider.setBudget(jobId, budget)).hash);
  note("fund", `${formatUnits(budget, 7)} ${currency.code} into the contract`, (await client.fund(jobId, budget)).hash);
  note("submit", "the deliverable's sha256", (await provider.submit(jobId, "the report, summarised")).hash);

  const job = await client.getJob(jobId);
  const opensAt = Number(job.finalizeAfter ?? 0n);
  const waitMs = Math.max(0, opensAt * 1000 - Date.now()) + 5_000;
  note("window", `waiting ${Math.round(waitMs / 1000)} s for it to close`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  note("finalize", "anyone may; the provider is credited", (await provider.finalize(jobId)).hash);
  const owed = await provider.withdrawable();
  note("withdraw", `${formatUnits(owed, 7)} ${currency.code} to the provider`, (await provider.withdrawTo(providerKey.publicKey(), owed)).hash);
  note("provider balance", `${formatUnits(await usdcBalance(provider, providerKey.publicKey(), token), 7)} ${currency.code}`);

  write(rows, deployment, true);
}

function write(rows: Row[], deployment: SquareDeployment, settled: boolean): void {
  const explorer = networkFor(deployment.network).explorerUrl;
  const link = (hash: string): string => (explorer ? `[\`${hash.slice(0, 8)}…\`](${explorer}/tx/${hash})` : `\`${hash}\``);
  const body = [
    `# The TRY rail on ${deployment.network}`,
    "",
    `Run at ${new Date().toISOString()} against \`${anchorDomain}\`, whose **bank leg is simulated**: no lira`,
    "moves anywhere. What it pays is Circle's real testnet USDC, and every request below is a real",
    "SEP request answered by a real service.",
    "",
    `| | |`,
    `|---|---|`,
    `| Kernel | \`${deployment.squareJob}\` |`,
    `| Token | ${deployment.token.code} \`${deployment.token.contractId}\` |`,
    `| Anchor | \`${anchorDomain}\` |`,
    `| Settlement leg | ${settled ? "ran" : "not run — the anchor had not paid enough yet"} |`,
    "",
    "| Step | What happened | Transaction |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.step} | ${row.detail} | ${row.hash ? link(row.hash) : ""} |`),
    "",
  ].join("\n");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `try-rail-${deployment.network.replace("stellar:", "")}.md`);
  writeFileSync(file, body);
  console.info(`\nWrote ${file}`);
}

await main();
