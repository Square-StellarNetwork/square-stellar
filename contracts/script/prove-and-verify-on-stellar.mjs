#!/usr/bin/env node
// The compliance path end to end, on Stellar testnet: a policy is committed,
// a proof of a payment under it is made by the prover service in this process,
// and the proof is verified by the real network's BN254 host functions through
// a simulateTransaction, which costs nothing and needs no key. The Stellar
// counterpart of prove-and-verify-on-arc.mjs (#21, and the "verifies on
// Stellar Testnet" check of #44).
//
//   node script/prove-and-verify-on-stellar.mjs
//       against groth16_verifier from contracts/deployments/testnet.json (#10, #45)
//   node script/prove-and-verify-on-stellar.mjs --probe C… --vk services/prover/artifacts/payment_vk.json
//       against the A-cluster probe, with this build's own key: how the path is
//       checked before the verifier is deployed
//   --contract C…   a verifier at another id;  --rpc URL   another endpoint
//
// Needs the prover's artifacts (services/prover/artifacts, from
// `cd circuits && npm run build`) and its dependencies installed. Every value
// the proof is about is written out here rather than imported, so what is
// proved is visible in the file that proves it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, signalsOf, simulateVerify, targetFromArgs, withSignal } from './verify-on-stellar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const { buildCircuitInput, generateProof } = await import(path.join(REPO, 'services', 'prover', 'src', 'prover.js'));
const { addressToField } = await import(path.join(REPO, 'services', 'prover', 'src', 'hash.js'));
const { randomPolicySalt } = await import(path.join(REPO, 'services', 'prover', 'src', 'commitment.js'));
const { policyDataHash } = await import(path.join(REPO, 'circuits', 'test', 'helpers', 'inputs.mjs'));

// Real testnet addresses (docs/decisions/stellar-target.md, auth-and-token-flow.md,
// address-field-mapping.md): the USDC Stellar Asset Contract, the auth probe's
// client as the payee and its payer as the operator, and the pubnet USDC
// issuer as the blocked account. Amounts are USDC base units at 7 decimals.
//
// policy_salt is drawn per run and printed, never written here: a salt in a
// public repository no longer hides the eight committed values (square#98).
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const POLICY = {
  policy_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  operator_id: 'GCYUOI4ZTDRVX4STYKSQOZRSD3ZJ6ALX43WTS2N3M5LES63PW5IM272D',
  max_daily_spend: '1000000000',      // 100 USDC
  max_per_transaction: '100000000',   // 10 USDC
  allowed_endpoint_categories: ['api-call'],
  blocked_addresses: ['GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'],
  token_whitelist: [USDC],
  time_restrictions: [{
    timezone: 'UTC',
    allowed_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    allowed_hours_start: 9,
    allowed_hours_end: 18,
  }],
};

// A payment that satisfies all six rules. 2026-09-02T13:45:30Z is a Wednesday
// at 13:45 UTC, inside the window above.
const PAYMENT = {
  payment_recipient: 'GBGFKN6QTTVHBK6JLS2NAVDBW6VRA74HUPF7HS66HXL7YGEACA4SXOQ3',
  payment_token: USDC,
  payment_amount: '50000000',         // 5 USDC
  daily_spent_before: '500000000',    // 50 USDC
  payment_endpoint_category: 'api-call',
  current_unix_timestamp: '1788356730',
};

const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

async function main(argv) {
  const timings = [];
  const stage = async (name, fn) => {
    const startedAt = performance.now();
    const value = await fn();
    timings.push([name, performance.now() - startedAt]);
    return value;
  };
  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = actual === expected;
    if (!ok) failures += 1;
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}\n`);
  };

  const deploymentFile = path.resolve(flag(argv, '--deployment') ?? path.join(REPO, 'contracts', 'deployments', 'testnet.json'));
  const target = targetFromArgs(argv, deploymentFile);
  const url = flag(argv, '--rpc') ?? process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const { server, network, latestLedger } = await connect(url, target.passphrase ?? 'Test SDF Network ; September 2015');
  process.stdout.write(`rpc       ${url}\nnetwork   ${network.passphrase} | protocol ${network.protocolVersion} | ledger ${latestLedger}\nverifier  ${target.label}\n\n`);

  // ---------------------------------------------------- 1. policy → commitment
  const policySalt = randomPolicySalt();
  const request = { ...POLICY, ...PAYMENT, policy_salt: policySalt };
  const commit = async (req) => policyDataHash(await buildCircuitInput(req));
  const expectedCommitment = await stage('commitment', () => commit(request));
  const underAnotherSalt = await stage('commitment under another salt', () => commit({ ...request, policy_salt: randomPolicySalt() }));
  const recommitted = await stage('commitment again, same salt', () => commit(request));

  process.stdout.write('a policy, committed off chain\n');
  process.stdout.write(`  policy_salt       ${policySalt}\n`);
  process.stdout.write(`  policy_data_hash  ${expectedCommitment}\n`);
  process.stdout.write(`  another salt      ${underAnotherSalt}\n`);
  check('a different salt moves the commitment', String(underAnotherSalt !== expectedCommitment), 'true');
  check('the same salt does not', recommitted, expectedCommitment);
  process.stdout.write('\n');

  // ------------------------------------------------------------- 2. the proof
  const result = await stage('prove', () => generateProof(request));
  process.stdout.write('a proof built from that policy, now\n');
  check('the circuit committed to the same policy', result.public_signals.policy_data_hash, expectedCommitment);
  check('is_compliant', result.public_signals.is_compliant, '1');
  check('recipient is f of the payee', result.public_signals.recipient, addressToField(PAYMENT.payment_recipient));
  check('token is f of the USDC SAC', result.public_signals.token, addressToField(USDC));
  check('amount', result.public_signals.amount, PAYMENT.payment_amount);
  check('daily_spent_before', result.public_signals.daily_spent_before, PAYMENT.daily_spent_before);
  check('the off-circuit evaluator agrees', String(result.rules_agree), 'true');
  const proofHex = result.soroban.proof.slice(2);
  check('the Soroban blob is 512 bytes', String(proofHex.length / 2), '512');
  process.stdout.write('\n');

  // ------------------------------------------------- 3. testnet verifies it
  const verified = await stage('verify on testnet', () => simulateVerify(server, network.passphrase, target, proofHex));
  process.stdout.write('Stellar testnet verifies it\n');
  check('the proof verifies on chain', verified.outcome, 'valid');
  const signals = signalsOf(proofHex);
  const swapped = await stage('verify a substituted commitment', () => simulateVerify(server, network.passphrase, target, withSignal(proofHex, 1, BigInt(underAnotherSalt))));
  check('a substituted policy commitment is rejected', swapped.outcome, 'invalid');
  const bumped = await stage('verify an altered amount', () => simulateVerify(server, network.passphrase, target, withSignal(proofHex, 3, BigInt(`0x${signals[3]}`) + 1n)));
  check('an altered amount is rejected', bumped.outcome, 'invalid');
  process.stdout.write('\n');

  if (verified.outcome === 'valid') {
    process.stdout.write(`testnet cost of one verification: ${verified.instructions.toLocaleString('en-US')} instructions, minResourceFee ${verified.minResourceFee.toLocaleString('en-US')} stroops (${(verified.minResourceFee / 1e7).toFixed(7)} XLM)\n`);
  }
  const width = Math.max(...timings.map(([name]) => name.length));
  let total = 0;
  for (const [name, ms] of timings) {
    total += ms;
    process.stdout.write(`  ${name.padEnd(width)} ${ms.toFixed(0).padStart(6)} ms\n`);
  }
  process.stdout.write(`  ${'total'.padEnd(width)} ${total.toFixed(0).padStart(6)} ms\n\n`);

  if (failures > 0) {
    process.stdout.write(`${failures} check(s) failed.\n`);
    return 1;
  }
  process.stdout.write(`All checks passed on "${network.passphrase}" at ${url}.\n`);
  return 0;
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}
