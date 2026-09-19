#!/usr/bin/env node
// TypeScript bindings for the three ERC-8004 registries Square binds on
// testnet (#33, docs/decisions/8004-registries-on-stellar.md), read from the
// live contracts' own spec: each Wasm is fetched with `stellar contract fetch`,
// its sha256 held to the published hash in
// contracts/vendor/stellar-8004/interface.json, and
// `stellar contract bindings typescript` run on it. The table of that decision
// record and these bindings therefore describe the same bytes.
//
//   node scripts/generate-8004-bindings.mjs          write src/registry-bindings
//   node scripts/generate-8004-bindings.mjs --check  exit 1 if they are not what this writes
//
// Reaches the testnet RPC named in interface.json's header, so it runs in the
// stellar-8004 workflow, not in the hermetic contracts job. The stellar-cli and
// SDK pins are generate-bindings.mjs's: the action's default and this
// package's manifest.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..');
const ROOT = path.resolve(CORE, '..', '..');
const INTERFACE = path.join(ROOT, 'contracts', 'vendor', 'stellar-8004', 'interface.json');
const OUT = path.join(CORE, 'src', 'registry-bindings');
const check = process.argv.includes('--check');

function pinnedCli() {
  const action = fs.readFileSync(path.join(ROOT, '.github', 'actions', 'stellar-cli', 'action.yml'), 'utf8');
  const match = action.match(/^  version:\n(?:    .*\n)*?    default: (\S+)$/m);
  if (!match) throw new Error('.github/actions/stellar-cli/action.yml has no default version');
  return match[1];
}

function pinnedSdk() {
  const version = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')).dependencies?.['@stellar/stellar-sdk'];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`packages/core/package.json does not pin @stellar/stellar-sdk exactly: ${version}`);
  return version;
}

const stellar = (args) => execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const version = stellar(['--version']).split('\n')[0];
if (!version.startsWith(`stellar ${pinnedCli()} `)) {
  console.error(`stellar-cli ${pinnedCli()} is pinned (docs/decisions/stellar-target.md); found "${version}"`);
  process.exit(1);
}
const STELLAR_SDK = pinnedSdk();

const { header } = JSON.parse(fs.readFileSync(INTERFACE, 'utf8'));
const network = ['--rpc-url', header.network.rpc_url, '--network-passphrase', header.network.network_passphrase];
const fetched = fs.mkdtempSync(path.join(os.tmpdir(), 'square-8004-wasm-'));
const target = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'square-8004-bindings-')) : OUT;
if (!check) fs.rmSync(OUT, { recursive: true, force: true });

try {
  for (const [name, registry] of Object.entries(header.registries)) {
    const wasm = path.join(fetched, `${name}.wasm`);
    stellar(['contract', 'fetch', '--id', registry.contract_id, ...network, '--out-file', wasm]);
    const sha = createHash('sha256').update(fs.readFileSync(wasm)).digest('hex');
    if (sha !== registry.published_wasm_sha256) {
      throw new Error(`${name} (${registry.contract_id}) is ${sha}, not the published ${registry.published_wasm_sha256}: the contract changed; run contracts/tools/check-8004-interface.mjs`);
    }
    const dir = path.join(target, path.basename(registry.port_wasm, '.wasm'));
    stellar(['contract', 'bindings', 'typescript', '--wasm', wasm, '--output-dir', dir, '--overwrite']);
    const manifestPath = path.join(dir, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['@stellar/stellar-sdk'] = STELLAR_SDK;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
} finally {
  fs.rmSync(fetched, { recursive: true, force: true });
}

const names = Object.values(header.registries).map((r) => path.basename(r.port_wasm, '.wasm'));
if (check) {
  let drift = false;
  try {
    execFileSync('diff', ['-r', OUT, target], { stdio: 'inherit' });
  } catch {
    drift = true;
  }
  fs.rmSync(target, { recursive: true, force: true });
  if (drift) {
    console.error('\nsrc/registry-bindings is not what scripts/generate-8004-bindings.mjs writes from the live contracts; run it and commit the result');
    process.exit(1);
  }
  console.log(`src/registry-bindings is current (${names.join(', ')}; ${version})`);
} else {
  console.log(`wrote src/registry-bindings for ${names.join(', ')} from the live testnet contracts (${version})`);
}
