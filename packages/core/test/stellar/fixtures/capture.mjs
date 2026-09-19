#!/usr/bin/env node
// Captures the fixtures in this directory from Stellar testnet, raw, as the
// RPC answered them: the SDK parses them in the tests the way it parses a
// live answer. Written 2026-09-19; rerun to refresh them.
//
//   node test/stellar/fixtures/capture.mjs
//
// The `trust` simulation and the account entry need a funded account; one is
// made here, funded by Friendbot, and its secret lives only in this process.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const write = (name, value) => fs.writeFileSync(path.join(HERE, name), `${JSON.stringify(value, null, 2)}\n`);

// docs/decisions/auth-and-token-flow.md, tree 6: the real `fund` on the auth probe.
const FUND_TX = "0dca3bf887508c0cb5bea31b1d57cd45cf955363024bc606dd3a0dfab4692249";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const KERNEL = "CCRIALS4QIRS52ZWBP2VAPBIVNKYC23D3IARZKCSNPY6WD5RZHONZIFY";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
// A fixed, never-funded account, so the refusal reads the same on every capture.
const NOBODY = "GATPIGKSWOW7VUFJKJBHY6NO3DUWGYHAG6I7VVPXVYOHSSZ6PFFQ3RUA";

const invoke = (source, contract, fn, args) =>
  new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(60)
    .build();

write("getTransaction.fund.json", await server._getTransaction(FUND_TX));

const transferToKernel = [nativeToScVal("transfer", { type: "symbol" }).toXDR("base64"), "*", nativeToScVal(KERNEL, { type: "address" }).toXDR("base64"), "*"];
write("getEvents.fund-transfer.json", await server._getEvents({ startLedger: 4760300, endLedger: 4760320, filters: [{ type: "contract", contractIds: [XLM_SAC], topics: [transferToKernel] }], limit: 10 }));

const nobody = new Account(NULL_ACCOUNT, "0");
write("simulateTransaction.usdc-decimals.json", await server._simulateTransaction(invoke(nobody, USDC_SAC, "decimals", [])));
write("simulateTransaction.trustline-missing.json", await server._simulateTransaction(invoke(nobody, USDC_SAC, "balance", [nativeToScVal(NOBODY, { type: "address" })])));

const keypair = Keypair.random();
const funded = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
if (!funded.ok) throw new Error(`friendbot refused ${keypair.publicKey()}: ${funded.status}`);
const account = await server.getAccount(keypair.publicKey());
write("simulateTransaction.usdc-trust.json", await server._simulateTransaction(invoke(account, USDC_SAC, "trust", [nativeToScVal(keypair.publicKey(), { type: "address" })])));
const accountKey = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(keypair.publicKey()).xdrAccountId() }));
write("getLedgerEntries.account.json", { publicKey: keypair.publicKey(), ...(await server._getLedgerEntries(accountKey)) });

console.log(`wrote ${fs.readdirSync(HERE).filter((name) => name.endsWith(".json")).join(", ")}`);
