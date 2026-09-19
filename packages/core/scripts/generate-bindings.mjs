#!/usr/bin/env node
// TypeScript bindings for every Soroban contract in contracts/contracts/, the
// Stellar counterpart of generate-abis.mjs (#7).
//
// Builds the workspace with the pinned stellar-cli, then runs
// `stellar contract bindings typescript` on each contract's Wasm into
// src/bindings/<name>/. The generated package.json asks for
// "@stellar/stellar-sdk": "^16.0.1"; it is rewritten to the pinned version, so
// every package.json in the repository names the same SDK.
//
// Neither version is written here. docs/decisions/stellar-target.md decides
// them; the stellar-cli pin is the default of .github/actions/stellar-cli
// (what CI installs) and the SDK pin is contracts/probes/package.json's.
//
// src/bindings/square_job is compiled into @squaresdk/core (#23 reads its spec
// and tables); the other bindings are skeletons and stay excluded in tsconfig
// until their contracts land.
//
//   node scripts/generate-bindings.mjs          write src/bindings
//   node scripts/generate-bindings.mjs --check  exit 1 if src/bindings is not what this writes
//
// Needs `stellar` on PATH at the pinned version, and the Rust toolchain
// contracts/rust-toolchain.toml names.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..');
const ROOT = path.resolve(CORE, '..', '..');
const CONTRACTS = path.join(ROOT, 'contracts');

function pinnedCli() {
  const action = fs.readFileSync(path.join(ROOT, '.github', 'actions', 'stellar-cli', 'action.yml'), 'utf8');
  const match = action.match(/^  version:\n(?:    .*\n)*?    default: (\S+)$/m);
  if (!match) throw new Error('.github/actions/stellar-cli/action.yml has no default version');
  return match[1];
}

function pinnedSdk() {
  const manifest = JSON.parse(fs.readFileSync(path.join(CONTRACTS, 'probes', 'package.json'), 'utf8'));
  const version = manifest.dependencies?.['@stellar/stellar-sdk'];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`contracts/probes/package.json does not pin @stellar/stellar-sdk exactly: ${version}`);
  return version;
}

const STELLAR_CLI = pinnedCli();
const STELLAR_SDK = pinnedSdk();
const OUT = path.join(CORE, 'src', 'bindings');
const check = process.argv.includes('--check');

function stellar(args, options = {}) {
  return execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

const version = stellar(['--version']).split('\n')[0];
if (!version.startsWith(`stellar ${STELLAR_CLI} `)) {
  console.error(`stellar-cli ${STELLAR_CLI} is pinned (docs/decisions/stellar-target.md); found "${version}"`);
  process.exit(1);
}

const names = fs
  .readdirSync(path.join(CONTRACTS, 'contracts'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of names) stellar(['contract', 'build', '--package', name], { cwd: CONTRACTS });

const target = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'square-bindings-')) : OUT;
if (!check) fs.rmSync(OUT, { recursive: true, force: true });

for (const name of names) {
  const wasm = path.join(CONTRACTS, 'target', 'wasm32v1-none', 'release', `${name}.wasm`);
  const dir = path.join(target, name);
  stellar(['contract', 'bindings', 'typescript', '--wasm', wasm, '--output-dir', dir, '--overwrite']);
  const manifestPath = path.join(dir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['@stellar/stellar-sdk'] = STELLAR_SDK;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (check) {
  let drift = false;
  try {
    execFileSync('diff', ['-r', OUT, target], { stdio: 'inherit' });
  } catch {
    drift = true;
  }
  fs.rmSync(target, { recursive: true, force: true });
  if (drift) {
    console.error('\nsrc/bindings is not what scripts/generate-bindings.mjs writes; run `npm run generate:bindings` and commit the result');
    process.exit(1);
  }
  console.log(`src/bindings is current (${names.length} contracts, ${version})`);
} else {
  console.log(`wrote src/bindings for ${names.length} contracts: ${names.join(', ')} (${version})`);
}
