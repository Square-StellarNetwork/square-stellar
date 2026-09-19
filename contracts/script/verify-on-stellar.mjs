#!/usr/bin/env node
// Verify a proof the prover service made against Stellar testnet, without a
// funded key: a simulateTransaction of the verifier, which runs the BN254
// host functions of the real network (CAP-0074, CAP-0080) and charges nothing.
// "The proof verifies with snarkjs" and "the proof verifies on Stellar" are
// different claims; this is the second, the one #21 and the "verifies on
// Stellar Testnet" check (#44) ask for.
//
//   node script/verify-on-stellar.mjs --proof <file>
//       <file> is a `POST /prove` response (its `soroban.proof`), or a file
//       holding the 512-byte blob as hex. The verifier is groth16_verifier
//       from contracts/deployments/testnet.json (#10, #45).
//   node script/verify-on-stellar.mjs --proof <file> --contract C…
//       a verifier at another id, `verify_proof(proof: Bytes) -> bool`.
//   node script/verify-on-stellar.mjs --proof <file> --probe C… --vk <payment_vk.json>
//       the A-cluster probe (contracts/probes/groth16_probe), which takes the
//       key as an argument: `verify(vk: Bytes, proof: Bytes) -> bool`. This is
//       how a proof is checked before #10's verifier is deployed, and how a
//       development key's proofs are checked at all.
//
//   --expect invalid   for a proof that should not verify
//   --rpc URL          the endpoint; default https://soroban-testnet.stellar.org
//   --deployment FILE  the record naming the verifier; default contracts/deployments/testnet.json
//
// The endpoint is checked before any claim is made: it has to answer
// getNetwork with the testnet passphrase (or the deployment record's). A
// quickstart network reports "Standalone Network ; February 2017" and is
// refused, since the claim here is "testnet's host agreed".
//
// The Stellar SDK is resolved through services/prover, which pins it
// (docs/decisions/stellar-target.md) and is installed wherever this runs:
// prove-and-verify-on-stellar.mjs needs the prover anyway.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'services', 'prover', 'package.json'));
const { Account, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } = require('@stellar/stellar-sdk');

const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';
const NULL_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const PROOF_BYTES = 512;

export function readProofHex(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  let hex = text;
  if (text.startsWith('{')) {
    const body = JSON.parse(text);
    hex = body?.soroban?.proof ?? body?.proof;
    if (typeof hex !== 'string') throw new Error(`${file}: no soroban.proof in it`);
  }
  hex = hex.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length !== PROOF_BYTES * 2) {
    throw new Error(`${file}: the proof is not ${PROOF_BYTES} bytes of hex`);
  }
  return hex;
}

// The eight signals as the blob carries them, for the tamper checks.
export function signalsOf(proofHex) {
  return proofHex.slice(512).match(/.{64}/g);
}

export function withSignal(proofHex, index, value) {
  const words = signalsOf(proofHex);
  words[index] = BigInt(value).toString(16).padStart(64, '0');
  return proofHex.slice(0, 512) + words.join('');
}

const bytes = (hex) => nativeToScVal(Buffer.from(hex.replace(/^0x/, ''), 'hex'), { type: 'bytes' });

/**
 * Simulate one verification. Answers `{ outcome, instructions, minResourceFee }`
 * with outcome `valid`, `invalid` or `error` (the host trapped: a point that
 * does not decode, a wrong-length blob).
 */
export async function simulateVerify(server, passphrase, target, proofHex) {
  const args = target.vk === undefined ? [bytes(proofHex)] : [bytes(target.vk), bytes(proofHex)];
  const built = new TransactionBuilder(new Account(NULL_ACCOUNT, '0'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(Operation.invokeContractFunction({ contract: target.contractId, function: target.method, args }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) return { outcome: 'error', error: sim.error.split('\n')[0] };
  const value = scValToNative(sim.result.retval);
  const instructions = sim.transactionData.build().resources().instructions();
  return { outcome: value === true ? 'valid' : 'invalid', instructions, minResourceFee: Number(sim.minResourceFee) };
}

export function targetFromArgs(argv, deploymentFile) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const probe = flag('--probe');
  if (probe) {
    const vkFile = flag('--vk');
    if (!vkFile) throw new Error('--probe needs --vk <payment_vk.json>: the probe takes the key as an argument');
    // The blob layout is the prover's own encoding of the key (services/prover/src/convert.js).
    const { encodeVerifyingKey } = require('./src/convert.js');
    const vk = encodeVerifyingKey(JSON.parse(fs.readFileSync(vkFile, 'utf8'))).blob;
    return { contractId: probe, method: 'verify', vk, label: `probe ${probe} with the key of ${path.basename(vkFile)}` };
  }
  const explicit = flag('--contract');
  if (explicit) return { contractId: explicit, method: 'verify_proof', label: `groth16_verifier ${explicit}` };
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(
      `${path.relative(REPO, deploymentFile)} is not there: no groth16_verifier is deployed yet (#10, #45). `
      + 'Pass --contract C…, or --probe C… --vk payment_vk.json to check against the A-cluster probe.',
    );
  }
  const record = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  const contractId = record?.contracts?.groth16_verifier;
  if (typeof contractId !== 'string') throw new Error(`${deploymentFile} names no contracts.groth16_verifier`);
  return { contractId, method: 'verify_proof', label: `groth16_verifier ${contractId} (${path.relative(REPO, deploymentFile)})`, passphrase: record.networkPassphrase };
}

export async function connect(url, expectedPassphrase) {
  const server = new rpc.Server(url, { allowHttp: url.startsWith('http://') });
  const network = await server.getNetwork();
  if (network.passphrase !== expectedPassphrase) {
    throw new Error(`${url} is "${network.passphrase}", not "${expectedPassphrase}". Nothing below would be a statement about that network.`);
  }
  const health = await server.getHealth();
  return { server, network, latestLedger: health.latestLedger };
}

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const proofFile = flag('--proof');
  if (!proofFile) throw new Error('usage: verify-on-stellar.mjs --proof <file> [--contract C… | --probe C… --vk <file>] [--expect invalid] [--rpc URL]');
  const proofHex = readProofHex(proofFile);
  const deploymentFile = path.resolve(flag('--deployment') ?? path.join(REPO, 'contracts', 'deployments', 'testnet.json'));
  const target = targetFromArgs(argv, deploymentFile);
  const passphrase = target.passphrase ?? Networks.TESTNET;
  const url = flag('--rpc') ?? process.env.STELLAR_RPC_URL ?? DEFAULT_RPC;
  const expected = flag('--expect') ?? 'valid';

  const { server, network, latestLedger } = await connect(url, passphrase);
  process.stdout.write(`rpc       ${url}\nnetwork   ${network.passphrase} | protocol ${network.protocolVersion} | ledger ${latestLedger}\nverifier  ${target.label}\nproof     ${path.relative(process.cwd(), proofFile)} (${PROOF_BYTES} bytes)\n\n`);

  let failures = 0;
  const check = async (label, hex, want) => {
    const result = await simulateVerify(server, passphrase, target, hex);
    const ok = result.outcome === want;
    if (!ok) failures += 1;
    const cost = result.outcome === 'error' ? `host: ${result.error}` : `instructions ${result.instructions.toLocaleString('en-US')} | minResourceFee ${result.minResourceFee.toLocaleString('en-US')} stroops`;
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${result.outcome.padEnd(7)} (expected ${want}) ${cost}\n`);
    return result;
  };

  process.stdout.write('the proof as the prover made it\n');
  await check(`verifies: ${expected}`, proofHex, expected);
  if (expected === 'valid') {
    process.stdout.write('\ntampering is rejected\n');
    const signals = signalsOf(proofHex);
    const isCompliant = BigInt(`0x${signals[0]}`);
    await check('flipped is_compliant', withSignal(proofHex, 0, isCompliant === 1n ? 0n : 1n), 'invalid');
    await check('altered amount', withSignal(proofHex, 3, BigInt(`0x${signals[3]}`) + 1n), 'invalid');
    const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    await check('a signal plus r, the same element unreduced', withSignal(proofHex, 2, BigInt(`0x${signals[2]}`) + r), 'invalid');
  }

  if (failures > 0) {
    process.stderr.write(`\n${failures} check(s) failed\n`);
    return 1;
  }
  process.stdout.write(`\nAll checks passed on "${network.passphrase}" at ${url}.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  }
}
