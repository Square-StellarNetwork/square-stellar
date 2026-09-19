#!/usr/bin/env node
/**
 * `check:deployed-wasm` (#19, B12; replaces `check:selectors`).
 *
 * A deployment record names a contract id and the sha256 of the Wasm it was
 * deployed from. On Soroban a contract instance stores the hash of its
 * executable, and that hash is the sha256 of the uploaded bytes, so the chain
 * can be asked what it is running without downloading anything.
 *
 * Three values are compared, and the third is the one that catches a stack
 * behind main:
 *
 *   record   what contracts/deployments/<network>.json says was deployed
 *   chain    what the contract instance actually points at
 *   built    the sha256 of the Wasm in target/, when it has been built
 *
 * record ≠ chain means the record is wrong: something was redeployed without
 * writing it down. chain ≠ built means the deployment is behind the working
 * tree, which is the failure that used to reach the app and the keeper as a
 * revert on a method the deployed contract does not have.
 *
 * Usage: node scripts/check-deployed-wasm.mjs [network] [--rpc URL]
 *   network defaults to SQUARE_NETWORK, then to every record on disk.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const recordsDir = join(repoRoot, "contracts", "deployments");
const wasmDir = join(repoRoot, "contracts", "target", "wasm32v1-none", "release");

const RPC_BY_NETWORK = {
  "stellar:testnet": "https://soroban-testnet.stellar.org",
  "stellar:local": "http://localhost:8000/soroban/rpc",
};

function parseArgs(argv) {
  const args = { network: process.env["SQUARE_NETWORK"], rpcUrl: process.env["RPC_URL"] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--rpc") {
      args.rpcUrl = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith("-")) {
      args.network = arg;
    }
  }
  return args;
}

function isStellarRecord(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed?.network === "string" && parsed.network.startsWith("stellar:");
  } catch {
    return false;
  }
}

function recordFiles(network) {
  if (network) {
    const name = `${network.replace(/^stellar:/, "")}.json`;
    const file = join(recordsDir, name);
    if (!existsSync(file)) throw new Error(`no deployment record at contracts/deployments/${name}`);
    if (!isStellarRecord(file)) throw new Error(`contracts/deployments/${name} is not a Stellar record; its network is not a stellar: id`);
    return [file];
  }
  // contracts/deployments/ still holds the Arc records, which name a chain id
  // rather than a stellar: network and have no Wasm to check. Reading every
  // file and skipping those is how the directory stays one place while the
  // port is in progress.
  const files = readdirSync(recordsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(recordsDir, name))
    .filter(isStellarRecord);
  if (files.length === 0) throw new Error("no Stellar deployment records in contracts/deployments; deploy first (contracts/script/deploy.sh)");
  return files;
}

/**
 * The hash of the executable a contract instance points at. A contract
 * deployed from uploaded Wasm answers with that Wasm's sha256; one that is a
 * Stellar Asset Contract answers with nothing, which is why the payment token
 * is not checked here.
 */
async function deployedWasmHash(server, contractId) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const answer = await server.getLedgerEntries(key);
  const entry = answer.entries?.[0];
  if (!entry) throw new Error(`no instance entry for ${contractId}: it is not deployed here, or it has been archived`);
  const instance = entry.val.contractData().val().instance();
  const executable = instance.executable();
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new Error(`${contractId} is not deployed from uploaded Wasm (${executable.switch().name})`);
  }
  return executable.wasmHash().toString("hex");
}

function builtWasmHash(crate) {
  const file = join(wasmDir, `${crate}.wasm`);
  if (!existsSync(file)) return undefined;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function checkRecord(file, rpcOverride) {
  const record = JSON.parse(readFileSync(file, "utf8"));
  const network = record.network;
  const rpcUrl = rpcOverride ?? RPC_BY_NETWORK[network];
  if (!rpcUrl) throw new Error(`no RPC endpoint known for ${network}; pass --rpc URL`);
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  const onChainNetwork = await server.getNetwork();
  if (onChainNetwork.passphrase !== record.networkPassphrase) {
    throw new Error(`${rpcUrl} is "${onChainNetwork.passphrase}", not the record's "${record.networkPassphrase}"`);
  }

  const contracts = record.contracts ?? {};
  const recorded = record.wasm ?? {};
  const problems = [];
  const rows = [];

  for (const [crate, contractId] of Object.entries(contracts)) {
    const chain = await deployedWasmHash(server, contractId);
    const expected = recorded[crate];
    const built = builtWasmHash(crate);
    rows.push({ crate, contractId, chain, expected, built });

    if (!expected) {
      problems.push(`${crate}: the record names no sha256 for it, so nothing pins what ${contractId} is running`);
    } else if (expected !== chain) {
      problems.push(`${crate}: the record says ${expected}, ${contractId} is running ${chain}`);
    }
    if (built && built !== chain) {
      problems.push(`${crate}: ${contractId} is behind this tree (chain ${chain}, built ${built})`);
    }
  }

  return { network, rpcUrl, rows, problems };
}

async function main() {
  const { network, rpcUrl } = parseArgs(process.argv.slice(2));
  let failed = false;

  for (const file of recordFiles(network)) {
    const { network: id, rpcUrl: endpoint, rows, problems } = await checkRecord(file, rpcUrl);
    console.log(`${id} via ${endpoint}`);
    for (const row of rows) {
      const state = !row.expected ? "unpinned" : row.expected !== row.chain ? "stale record" : row.built && row.built !== row.chain ? "behind tree" : "ok";
      console.log(`  ${row.crate.padEnd(20)} ${row.contractId}  ${row.chain.slice(0, 12)}…  ${state}`);
    }
    if (problems.length > 0) {
      failed = true;
      for (const problem of problems) console.error(`  error: ${problem}`);
    }
  }

  if (failed) {
    console.error("\nThe deployed stack and the record do not agree. Redeploy (contracts/script/deploy.sh),");
    console.error("or write the record the chain actually holds; docs/deploy/stellar-mvp.md has the runbook.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
