#!/usr/bin/env node
// docs/decisions/groth16-on-soroban.md (#2), on Stellar testnet: every case in
// groth16_probe/vectors.json simulated against the deployed probe, and one
// verification of the prover's compliant proof sent for real so the fee
// testnet actually charges is on record next to the simulated one.
//
//   stellar contract build            (in contracts/, builds groth16_probe.wasm)
//   node scripts/groth16-testnet.mjs  deploy the probe, then simulate and send
//   node scripts/groth16-testnet.mjs --contract C…   reuse a deployed probe; simulate only
//
// Simulations are free and need no key. The upload, the creation and the one
// real verification are paid by an account made for this run (lib/stellar.mjs).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  assertTestnet,
  bytes,
  createContract,
  ephemeralAccount,
  invoke,
  simulate,
  stroopsToXlm,
  uploadWasm,
} from './lib/stellar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(HERE, '..', '..');
const WASM = path.join(CONTRACTS, 'target', 'wasm32v1-none', 'release', 'groth16_probe.wasm');
const VECTORS = JSON.parse(fs.readFileSync(path.join(CONTRACTS, 'probes', 'groth16_probe', 'vectors.json'), 'utf8'));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const network = await assertTestnet();
console.log(`network   ${network.passphrase} | protocol ${network.protocol} | ledger ${network.ledger} | ${network.rpc}`);

let contractId = arg('--contract');
let payer;
if (!contractId) {
  payer = await ephemeralAccount();
  console.log(`payer     ${payer.publicKey()} (made for this run, funded by Friendbot)`);
  const upload = await uploadWasm(payer, WASM);
  console.log(`upload    wasm sha256 ${upload.wasmHash} | ${upload.wasmBytes} bytes | tx ${upload.hash} | fee ${stroopsToXlm(upload.feeCharged)} XLM`);
  const created = await createContract(payer, upload.wasmHash);
  contractId = created.contractId;
  console.log(`contract  ${contractId} | tx ${created.hash} | fee ${stroopsToXlm(created.feeCharged)} XLM`);
}

console.log('\nsimulateTransaction: verify(vk, proof)');
let failures = 0;
for (const [set, body] of Object.entries(VECTORS.sets)) {
  for (const c of body.cases) {
    const sim = await simulate(contractId, 'verify', [bytes(body.vk), bytes(c.proof)]);
    const outcome = !sim.ok ? 'error' : sim.value === true ? 'valid' : 'invalid';
    const ok = outcome === c.expect;
    if (!ok) failures += 1;
    const cost = sim.ok
      ? `instructions ${sim.instructions} | read ${sim.diskReadBytes} B, ${sim.readEntries} entries | minResourceFee ${sim.minResourceFee} stroops (${stroopsToXlm(sim.minResourceFee)} XLM)`
      : `host: ${sim.error.split('\n')[0].slice(0, 110)}`;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${set.padEnd(8)} ${c.name.padEnd(36)} ${outcome.padEnd(7)} (expected ${c.expect}) ${cost}`);
  }
}

if (payer) {
  const fixtures = VECTORS.sets.fixtures;
  const compliant = fixtures.cases.find((c) => c.name === 'compliant');
  const sent = await invoke(payer, contractId, 'verify', [bytes(fixtures.vk), bytes(compliant.proof)]);
  console.log(`\nsent      verify(compliant) -> ${sent.returnValue} | tx ${sent.hash} | ledger ${sent.ledger} | fee charged ${sent.feeCharged} stroops (${stroopsToXlm(sent.feeCharged)} XLM)`);
}

if (failures) {
  console.error(`\n${failures} case(s) did not have their declared outcome`);
  process.exit(1);
}
console.log('\nevery case had its declared outcome');
