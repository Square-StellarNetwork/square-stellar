// What the probe scripts need from Stellar testnet: an account to pay for the
// few transactions that must really happen (a Wasm upload, a contract
// creation), and simulations for everything else.
//
// The paying account is made here and lives only in this process: a random
// keypair, funded by Friendbot, whose secret is never printed, logged or
// written anywhere. Only its public key is reported. Probe contracts take no
// owner and hold nothing, so nothing depends on the key surviving the run.

import fs from 'node:fs';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

export const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
const FRIENDBOT = 'https://friendbot.stellar.org';

export const server = new rpc.Server(RPC_URL);

// The claim these scripts make is "testnet agreed", so the endpoint has to be testnet.
export async function assertTestnet() {
  const network = await server.getNetwork();
  if (network.passphrase !== PASSPHRASE) {
    throw new Error(`${RPC_URL} is "${network.passphrase}", not testnet`);
  }
  const latest = await server.getLatestLedger();
  return { rpc: RPC_URL, passphrase: network.passphrase, protocol: network.protocolVersion, ledger: latest.sequence };
}

export async function ephemeralAccount() {
  const keypair = Keypair.random();
  const response = await fetch(`${FRIENDBOT}/?addr=${keypair.publicKey()}`);
  if (!response.ok) throw new Error(`friendbot refused ${keypair.publicKey()}: ${response.status}`);
  return keypair;
}

async function send(keypair, operation) {
  const source = await server.getAccount(keypair.publicKey());
  const built = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  const result = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (result.status !== 'SUCCESS') throw new Error(`${sent.hash}: ${result.status}`);
  return { hash: sent.hash, ledger: result.ledger, feeCharged: result.resultXdr.feeCharged().toString(), result };
}

export async function uploadWasm(keypair, wasmPath) {
  const wasm = fs.readFileSync(wasmPath);
  const sent = await send(keypair, Operation.uploadContractWasm({ wasm }));
  return { ...sent, wasmHash: hash(wasm).toString('hex'), wasmBytes: wasm.length };
}

export async function createContract(keypair, wasmHash, constructorArgs = []) {
  const sent = await send(
    keypair,
    Operation.createCustomContract({
      address: Address.fromString(keypair.publicKey()),
      wasmHash: Buffer.from(wasmHash, 'hex'),
      salt: Buffer.from(Keypair.random().rawPublicKey()),
      constructorArgs,
    }),
  );
  const contractId = Address.fromScAddress(sent.result.returnValue.address()).toString();
  return { ...sent, contractId };
}

export async function invoke(keypair, contractId, fn, args) {
  const sent = await send(keypair, Operation.invokeContractFunction({ contract: contractId, function: fn, args }));
  return { ...sent, returnValue: scValToNative(sent.result.returnValue) };
}

// A simulation needs a source account but never loads it, so a fresh random
// one is used: nothing is signed, nothing is sent, nothing is paid.
export async function simulate(contractId, fn, args, sourceKey = Keypair.random().publicKey()) {
  const built = new TransactionBuilder(new Account(sourceKey, '0'), { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: contractId, function: fn, args }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error, sim };
  const resources = sim.transactionData.build().resources();
  const footprint = resources.footprint();
  return {
    ok: true,
    value: scValToNative(sim.result.retval),
    auth: sim.result.auth,
    minResourceFee: sim.minResourceFee,
    instructions: resources.instructions(),
    diskReadBytes: resources.diskReadBytes(),
    writeBytes: resources.writeBytes(),
    readEntries: footprint.readOnly().length + footprint.readWrite().length,
    latestLedger: sim.latestLedger,
    sim,
  };
}

export const bytes = (hex) => nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
export const stroopsToXlm = (stroops) => (Number(stroops) / 1e7).toFixed(7);
export { xdr, Address, nativeToScVal, scValToNative };
