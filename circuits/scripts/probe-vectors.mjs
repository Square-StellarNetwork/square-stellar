#!/usr/bin/env node
// The real proofs behind the Soroban probe vectors (#2, #4), from the key
// build.mjs made on this machine. Run after `node scripts/build.mjs`.
//
//   node scripts/probe-vectors.mjs <out-dir>
//
// Writes, in snarkjs' own shapes:
//   <out-dir>/snarkjs/{vk,proof,public}.json
//       a compliant payment with the default test input (test/helpers/inputs.mjs)
//   <out-dir>/stellar/{compliant,blocked}.{proof,public}.json
//       the same circuit and key with recipient, token, operator and the list
//       entries set to f(address) of real Stellar addresses
//       (docs/decisions/address-field-mapping.md): a compliant payment to a G…
//       account, and one to a G… account on the blocked list.
//
// The addresses' field values are read from
// contracts/probes/address_field_probe/vectors.json, which
// contracts/probes/scripts/address-field.mjs writes.
//
// Every proof is checked with snarkjs.groth16.verify before it is written. A
// new run makes new proofs (Groth16 is randomised) and, after a new build, a new
// key; the committed vectors record one build, identified by the zkey sha256
// this prints.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';
import { buildInput, MAX_BLOCKED, MAX_WHITELIST } from '../test/helpers/inputs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WASM = path.join(ROOT, 'build', 'payment_js', 'payment.wasm');
const ZKEY = path.join(ROOT, 'build', 'payment.zkey');
const VK = path.join(ROOT, 'build', 'payment_vk.json');
const ADDRESSES = path.resolve(ROOT, '..', 'contracts', 'probes', 'address_field_probe', 'vectors.json');

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/probe-vectors.mjs <out-dir>');
  process.exit(2);
}

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
};
const pad = (values, size) => [...values, ...Array(size - values.length).fill('0')];

const vk = JSON.parse(fs.readFileSync(VK, 'utf8'));
console.log(`zkey sha256 ${createHash('sha256').update(fs.readFileSync(ZKEY)).digest('hex')}`);

async function prove(name, input, dir, prefix) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  if (!(await snarkjs.groth16.verify(vk, publicSignals, proof))) throw new Error(`${name} does not verify`);
  write(path.join(dir, `${prefix}proof.json`), proof);
  write(path.join(dir, `${prefix}public.json`), publicSignals);
  console.log(`${name.padEnd(20)} verifies; is_compliant=${publicSignals[0]} recipient=${publicSignals[2]}`);
  return publicSignals;
}

// snarkjs' own shape, default input.
const snarkjsDir = path.join(out, 'snarkjs');
write(path.join(snarkjsDir, 'vk.json'), vk);
await prove('snarkjs compliant', await buildInput(), snarkjsDir, '');

// Stellar addresses through f.
const vectors = JSON.parse(fs.readFileSync(ADDRESSES, 'utf8')).vectors;
const f = (name) => {
  const entry = vectors.find((v) => v.name === name);
  if (!entry) throw new Error(`${name} is not in ${ADDRESSES}`);
  return BigInt(`0x${entry.signal}`).toString();
};
const provider = f('usdc_issuer_testnet'); // a G… account as the payee
const blocked = f('usdc_issuer_pubnet'); // a G… account on the blocked list
const operator = f('usdc_sac_pubnet'); // only its f enters the commitment
const usdc = f('usdc_sac_testnet'); // the C… token

const stellarDir = path.join(out, 'stellar');
for (const [name, recipient] of [['compliant', provider], ['blocked', blocked]]) {
  const input = {
    ...(await buildInput()),
    token_whitelist: pad([usdc], MAX_WHITELIST),
    blocked_addresses: pad([blocked], MAX_BLOCKED),
    operator_id_field: operator,
    recipient_in: recipient,
    token_in: usdc,
  };
  const signals = await prove(`stellar ${name}`, input, stellarDir, `${name}.`);
  if (signals[2] !== recipient || signals[4] !== usdc) throw new Error(`${name}: signals do not carry f(address)`);
}
process.exit(0);
