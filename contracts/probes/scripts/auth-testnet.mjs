#!/usr/bin/env node
// docs/decisions/auth-and-token-flow.md (#5), on Stellar testnet: the
// authorization trees simulateTransaction records for the flows the decision
// relies on, against the real native-XLM Stellar Asset Contract, plus one fund
// sent for real with the client signing only its auth entry while another
// account submits and pays the fee.
//
//   stellar contract build --package auth_probe   (in contracts/)
//   node scripts/auth-testnet.mjs
//
// Two accounts are made for the run and never stored (lib/stellar.mjs): the
// payer deploys and submits, the client authorizes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Address,
  Asset,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  PASSPHRASE,
  assertTestnet,
  createContract,
  ephemeralAccount,
  server,
  simulate,
  stroopsToXlm,
  uploadWasm,
} from './lib/stellar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM = path.resolve(HERE, '..', '..', 'target', 'wasm32v1-none', 'release', 'auth_probe.wasm');
const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

const addr = (s) => new Address(s).toScVal();
const i128 = (n) => nativeToScVal(BigInt(n), { type: 'i128' });

// An authorization entry as an indented call tree.
function describe(entry) {
  const creds = entry.credentials();
  const signer = creds.switch().name === 'sorobanCredentialsAddress'
    ? `signed by ${Address.fromScAddress(creds.address().address()).toString()}`
    : 'the transaction source account';
  const lines = [`  auth entry, ${signer}`];
  const walk = (invocation, depth) => {
    const fn = invocation.function();
    if (fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
      const c = fn.contractFn();
      const args = c.args().map((a) => {
        const v = scValToNative(a);
        return typeof v === 'bigint' ? v.toString() : String(v);
      });
      lines.push(`${'    '.repeat(depth)}${Address.fromScAddress(c.contractAddress()).toString()}.${c.functionName().toString()}(${args.join(', ')})`);
    } else {
      lines.push(`${'    '.repeat(depth)}${fn.switch().name}`);
    }
    for (const sub of invocation.subInvocations()) walk(sub, depth + 1);
  };
  walk(entry.rootInvocation(), 2);
  return lines.join('\n');
}

function report(label, sim) {
  console.log(`\n${label}`);
  if (!sim.ok) {
    console.log(`  refused by the host: ${sim.error.split('\n')[0].slice(0, 160)}`);
    return;
  }
  console.log(`  returns ${JSON.stringify(sim.value ?? null)} | instructions ${sim.instructions} | minResourceFee ${sim.minResourceFee} stroops`);
  if (!sim.auth.length) console.log('  auth entries: none — no signature needed beyond the transaction source');
  for (const entry of sim.auth) console.log(describe(entry));
}

const network = await assertTestnet();
console.log(`network   ${network.passphrase} | protocol ${network.protocol} | ledger ${network.ledger}`);

const payer = await ephemeralAccount();
const client = await ephemeralAccount();
console.log(`payer     ${payer.publicKey()} (deploys, submits, pays fees)`);
console.log(`client    ${client.publicKey()} (authorizes only)`);

const upload = await uploadWasm(payer, WASM);
const kernel = (await createContract(payer, upload.wasmHash)).contractId;
const arbitration = (await createContract(payer, upload.wasmHash)).contractId;
const xlm = Asset.native().contractId(PASSPHRASE);
console.log(`wasm      sha256 ${upload.wasmHash}`);
console.log(`kernel    ${kernel}   (the probe playing SquareJob / KeeperEvaluator)`);
console.log(`arbitr.   ${arbitration}   (a second instance playing Arbitration)`);
console.log(`XLM SAC   ${xlm}`);

// Simulations run with the payer as source, as a relayer would submit them.
const src = payer.publicKey();

const fund = await simulate(kernel, 'fund', [addr(client.publicKey()), addr(xlm), i128(10_000_000)], src);
report('1. fund(client, XLM, 1 XLM): no approve; the transfer is inside the client’s authorization', fund);

report(
  '2. dispute(disputer, arbitration, XLM, 0.5 XLM): one signature covers dispute -> open -> transfer',
  await simulate(kernel, 'dispute', [addr(client.publicKey()), addr(arbitration), addr(xlm), i128(5_000_000)], src),
);

report(
  '3. finalize(kernel) on the arbitration instance: a contract as evaluator; complete(evaluator) needs no signature',
  await simulate(arbitration, 'finalize', [addr(kernel)], src),
);

report(
  '4. complete(evaluator = client) called directly: a G account as evaluator must sign',
  await simulate(kernel, 'complete', [addr(client.publicKey())], src),
);

report(
  '5. fund(client, USDC, 1 base unit) from an account with no USDC trustline',
  await simulate(kernel, 'fund', [addr(client.publicKey()), addr(USDC_TESTNET), i128(1)], src),
);

// Send #1 for real: the client signs its auth entry only; the payer submits and pays.
const { sequence } = await server.getLatestLedger();
const signedAuth = await Promise.all(fund.auth.map((entry) => authorizeEntry(entry, client, sequence + 60, PASSPHRASE)));
const source = await server.getAccount(payer.publicKey());
const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
  .addOperation(Operation.invokeContractFunction({
    contract: kernel,
    function: 'fund',
    args: [addr(client.publicKey()), addr(xlm), i128(10_000_000)],
    auth: signedAuth,
  }))
  .setTimeout(60)
  .build();
const prepared = await server.prepareTransaction(tx);
prepared.sign(payer);
const sent = await server.sendTransaction(prepared);
const result = await server.pollTransaction(sent.hash, { attempts: 30 });
console.log(`\nsent      fund signed by the client, submitted and paid by the payer -> ${result.status} | tx ${sent.hash} | fee ${stroopsToXlm(result.resultXdr.feeCharged().toString())} XLM paid by ${payer.publicKey()}`);
if (result.status !== 'SUCCESS') process.exit(1);
