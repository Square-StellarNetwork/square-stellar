#!/usr/bin/env node
// No Square contract can replace its own code
// (docs/decisions/upgradeability-and-governance.md, #49).
//
// A Soroban contract changes its Wasm only through the host function
// `update_current_contract_wasm`. A Wasm that never imports it cannot upgrade,
// whatever its exported functions are called. That import is the check. The
// export list is also checked for upgrade-shaped names, so a later attempt
// through a proxy pattern does not go unnoticed.
//
// The import's short module/field name is read from the env.json of the
// soroban-env-common that Cargo.lock resolves, not written down here, so the
// check follows the pinned SDK.
//
//   node tools/check-no-upgrade.mjs                  the nine contracts in contracts/contracts/
//   node tools/check-no-upgrade.mjs a.wasm b.wasm    any Wasm files
//
// Run after `stellar contract build`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(HERE, '..');
const UPGRADE_HOST_FN = 'update_current_contract_wasm';
const UPGRADE_SHAPED = /upgrade|migrat|set_?wasm|update_?wasm|update_?code/i;

function upgradeImport() {
  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: CONTRACTS, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }),
  );
  const common = metadata.packages.find((p) => p.name === 'soroban-env-common');
  if (!common) throw new Error('soroban-env-common is not in the dependency graph');
  const env = JSON.parse(fs.readFileSync(path.join(path.dirname(common.manifest_path), 'env.json'), 'utf8'));
  for (const module of env.modules) {
    const fn = module.functions.find((f) => f.name === UPGRADE_HOST_FN);
    if (fn) return { module: module.export, name: fn.export, version: common.version };
  }
  throw new Error(`${UPGRADE_HOST_FN} is not in soroban-env-common ${common.version}'s env.json`);
}

function defaultWasms() {
  const release = path.join(CONTRACTS, 'target', 'wasm32v1-none', 'release');
  return fs
    .readdirSync(path.join(CONTRACTS, 'contracts'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(release, `${d.name}.wasm`))
    .sort();
}

const target = upgradeImport();
const wasms = process.argv.slice(2).length ? process.argv.slice(2) : defaultWasms();
console.log(`${UPGRADE_HOST_FN} is import ("${target.module}", "${target.name}") in soroban-env-common ${target.version}`);

let failures = 0;
for (const file of wasms) {
  const module = new WebAssembly.Module(fs.readFileSync(file));
  const imports = WebAssembly.Module.imports(module);
  const exported = WebAssembly.Module.exports(module)
    .filter((e) => e.kind === 'function')
    .map((e) => e.name);
  const problems = [];
  if (imports.some((i) => i.module === target.module && i.name === target.name && i.kind === 'function')) {
    problems.push(`imports ${UPGRADE_HOST_FN}`);
  }
  const shaped = exported.filter((n) => UPGRADE_SHAPED.test(n));
  if (shaped.length) problems.push(`exports ${shaped.join(', ')}`);
  const name = path.relative(process.cwd(), file);
  if (problems.length) {
    failures += 1;
    console.log(`FAIL ${name}: ${problems.join('; ')}`);
  } else {
    console.log(`ok   ${name}: ${exported.length} exported function(s), no ${UPGRADE_HOST_FN} import`);
  }
}
if (failures) {
  console.error(`\n${failures} Wasm file(s) can upgrade; see docs/decisions/upgradeability-and-governance.md`);
  process.exit(1);
}
