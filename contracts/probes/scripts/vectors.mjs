#!/usr/bin/env node
// Writes groth16_probe/vectors.json: real proofs in the byte layout Soroban's
// BN254 host functions take, and the same proofs tampered with.
//
// Three sources, so the rule in encode.mjs is covered for both shapes a proof
// arrives in, and for proofs about Stellar addresses:
//
//   fixtures  contracts/test/fixtures/proofs.json with the key embedded in
//             contracts/src/Groth16Verifier.sol: the prover's proofs, in the
//             Solidity calldata shape (fp2 already imaginary-first).
//   snarkjs   groth16_probe/snarkjs/{vk,proof,public}.json: snarkjs' own output
//             (fp2 as [c0, c1]) for a key built by circuits/scripts/build.mjs.
//   stellar_addresses
//             address_field_probe/circuit/*.json: proofs from the same key, the
//             circuit unchanged, with recipient and token set to f(address) of
//             real Stellar accounts and contracts (address-field-mapping.md, #4).
//
// Both sets of proofs are written by circuits/scripts/probe-vectors.mjs.
//
// Every case carries the outcome it must have: "valid", "invalid" (verify
// returns false) or "error" (the host refuses the input and the call traps).
//
//   node scripts/vectors.mjs          write the file
//   node scripts/vectors.mjs --check  exit 1 if the file is not what this writes

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BN254_R,
  be32,
  proofFromSnarkjs,
  proofFromSolidity,
  vkBlob,
  vkFromSnarkjs,
  vkFromSolidity,
} from './encode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(HERE, '..', '..');
const PROBE = path.join(CONTRACTS, 'probes', 'groth16_probe');
const OUT = path.join(PROBE, 'vectors.json');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rel = (p) => path.relative(path.resolve(CONTRACTS, '..'), p);

// Public signal positions (circuits/README.md).
const IS_COMPLIANT = 0;
const POLICY_DATA_HASH = 1;
const AMOUNT = 3;

const withSignal = (signals, index, value) => signals.map((s, i) => (i === index ? value : s));

function fixtureSet() {
  const proofsFile = path.join(CONTRACTS, 'test', 'fixtures', 'proofs.json');
  const verifierFile = path.join(CONTRACTS, 'src', 'Groth16Verifier.sol');
  const proofs = read(proofsFile);
  const vk = vkFromSolidity(fs.readFileSync(verifierFile, 'utf8'));

  const valid = ['compliant', 'blocked', 'compliant_with_receipt', 'compliant_rerandomised'].map((name) => ({
    name,
    proof: proofFromSolidity(proofs[name]),
    expect: 'valid',
  }));

  const { compliant, blocked } = proofs;
  const tampered = [
    {
      name: 'blocked_with_is_compliant_flipped',
      note: 'blocked proves is_compliant = 0; the same proof claiming 1',
      proof: proofFromSolidity({ ...blocked, input: withSignal(blocked.input, IS_COMPLIANT, '1') }),
      expect: 'invalid',
    },
    {
      name: 'compliant_with_amount_changed',
      note: 'amount + 1 base unit',
      proof: proofFromSolidity({ ...compliant, input: withSignal(compliant.input, AMOUNT, (BigInt(compliant.input[AMOUNT]) + 1n).toString()) }),
      expect: 'invalid',
    },
    {
      name: 'compliant_with_signal_plus_r',
      note: 'policy_data_hash + r: the same field element, so it verifies unless the verifier refuses signals >= r',
      proof: proofFromSolidity({ ...compliant, input: withSignal(compliant.input, POLICY_DATA_HASH, (BigInt(compliant.input[POLICY_DATA_HASH]) + BN254_R).toString()) }),
      expect: 'invalid',
    },
    {
      name: 'compliant_with_b_in_snarkjs_order',
      note: 'B with each fp2 written c0 first, the way snarkjs stores it, instead of c1 first',
      proof: (() => {
        const [[x1, x0], [y1, y0]] = compliant.b;
        return proofFromSolidity({ ...compliant, b: [[x0, x1], [y0, y1]] });
      })(),
      expect: 'error',
    },
  ];

  return {
    source: [rel(proofsFile), rel(verifierFile)],
    zkey_sha256: proofs._provenance.zkey_sha256,
    vk: vkBlob(vk),
    cases: [...valid, ...tampered],
  };
}

function snarkjsSet() {
  const dir = path.join(PROBE, 'snarkjs');
  const vk = read(path.join(dir, 'vk.json'));
  const proof = read(path.join(dir, 'proof.json'));
  const signals = read(path.join(dir, 'public.json'));
  if (signals[IS_COMPLIANT] !== '1') throw new Error('the snarkjs vector is expected to be a compliant proof');
  return {
    source: [rel(path.join(dir, 'vk.json')), rel(path.join(dir, 'proof.json')), rel(path.join(dir, 'public.json'))],
    vk: vkBlob(vkFromSnarkjs(vk)),
    cases: [
      { name: 'compliant', proof: proofFromSnarkjs(proof, signals), expect: 'valid' },
      {
        name: 'compliant_with_is_compliant_flipped',
        note: 'is_compliant 1 -> 0',
        proof: proofFromSnarkjs(proof, withSignal(signals, IS_COMPLIANT, '0')),
        expect: 'invalid',
      },
      {
        name: 'compliant_with_amount_changed',
        note: 'amount + 1 base unit',
        proof: proofFromSnarkjs(proof, withSignal(signals, AMOUNT, (BigInt(signals[AMOUNT]) + 1n).toString())),
        expect: 'invalid',
      },
    ],
  };
}

function stellarAddressSet() {
  const dir = path.join(CONTRACTS, 'probes', 'address_field_probe', 'circuit');
  const vkFile = path.join(PROBE, 'snarkjs', 'vk.json');
  const vk = read(vkFile);
  const load = (name) => ({ proof: read(path.join(dir, `${name}.proof.json`)), signals: read(path.join(dir, `${name}.public.json`)) });
  const compliant = load('compliant');
  const blocked = load('blocked');
  const RECIPIENT = 2;
  return {
    source: [rel(vkFile), rel(path.join(dir, 'compliant.proof.json')), rel(path.join(dir, 'blocked.proof.json'))],
    vk: vkBlob(vkFromSnarkjs(vk)),
    cases: [
      { name: 'compliant_to_a_g_account', note: 'recipient = f(G…), token = f(USDC SAC, testnet)', proof: proofFromSnarkjs(compliant.proof, compliant.signals), expect: 'valid' },
      { name: 'blocked_g_account', note: 'the recipient is on the blocked list, so is_compliant = 0; still a valid proof', proof: proofFromSnarkjs(blocked.proof, blocked.signals), expect: 'valid' },
      {
        name: 'compliant_with_recipient_swapped',
        note: 'the compliant proof claiming the blocked account as its recipient',
        proof: proofFromSnarkjs(compliant.proof, withSignal(compliant.signals, RECIPIENT, blocked.signals[RECIPIENT])),
        expect: 'invalid',
      },
    ],
  };
}

const vectors = {
  _about: 'Groth16 proofs in the byte layout of CAP-0074 and their expected outcome. Written by contracts/probes/scripts/vectors.mjs; decided in docs/decisions/groth16-on-soroban.md.',
  layout: {
    g1: 'be(X) || be(Y), 64 bytes',
    g2: 'be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0), 128 bytes',
    vk: 'alpha(G1) || beta(G2) || gamma(G2) || delta(G2) || IC_0..IC_n(G1)',
    proof: 'A(G1) || B(G2) || C(G1) || n x signal(32 bytes, big-endian)',
    r: be32(BN254_R),
  },
  sets: { fixtures: fixtureSet(), snarkjs: snarkjsSet(), stellar_addresses: stellarAddressSet() },
};

const text = `${JSON.stringify(vectors, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error(`${rel(OUT)} is not what scripts/vectors.mjs writes; run it and commit the result`);
    process.exit(1);
  }
  console.log(`${rel(OUT)} is current`);
} else {
  fs.writeFileSync(OUT, text);
  const count = Object.values(vectors.sets).reduce((n, s) => n + s.cases.length, 0);
  console.log(`wrote ${rel(OUT)}: ${count} cases`);
}
