import { Address, Keypair, Networks, StrKey, Transaction, TransactionBuilder, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArchivedStateError,
  connectSquareClient,
  createSquareClient,
  DeploymentNetworkMismatchError,
  keypairSigner,
  SquareContractError,
  TransactionFailedError,
  TransactionPendingError,
  TransactionSendError,
  TrustlineMissingError,
  WalletRequiredError,
  type SquareClient,
  type SquareDeployment,
} from "../../src/stellar/index.js";
import { fixture, startMockRpc, type MockRpc } from "./rpcMock.js";

/**
 * The client against a stand-in RPC that answers with real testnet
 * responses (fixtures/, captured 2026-09-19): what the network said to a
 * `decimals` read, to a `balance` read of an account without a trustline,
 * to a `trust` simulation, and the `fund` transaction of
 * docs/decisions/auth-and-token-flow.md. The deployment names the USDC SAC
 * as the payment token and made-up ids for the rest; only the token is
 * called here, since only its interface is fixed today.
 */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const FUND_TX = "0dca3bf887508c0cb5bea31b1d57cd45cf955363024bc606dd3a0dfab4692249";
const other = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));

const deployment: SquareDeployment = {
  network: "stellar:testnet",
  networkPassphrase: Networks.TESTNET,
  squareJob: other(1),
  keeperEvaluator: other(2),
  arbitration: other(3),
  claimMarket: other(4),
  squareHook: other(5),
  policyRegistry: other(6),
  usdc: { code: "USDC", issuer: USDC_ISSUER, contractId: USDC_SAC, decimals: 7 },
  identityRegistry: other(7),
  reputationRegistry: other(8),
  validationRegistry: other(9),
};

const keypair = Keypair.random();
const signer = keypairSigner(keypair, Networks.TESTNET);

const testnet = { friendbotUrl: "https://friendbot.stellar.org/", passphrase: Networks.TESTNET, protocolVersion: 28 };
const pubnet = { passphrase: Networks.PUBLIC, protocolVersion: 28 };

let mock: MockRpc;
beforeEach(async () => {
  mock = await startMockRpc();
  mock.on("getNetwork", () => testnet);
});
afterEach(() => mock.close());

const client = (options: { signer?: boolean; timeoutInSeconds?: number } = {}): SquareClient =>
  createSquareClient({ deployment, rpc: mock.url, allowHttp: true, signer: options.signer ? signer : undefined, timeoutInSeconds: options.timeoutInSeconds });

/** The account entry `getAccount` reads, for whichever address is asked. */
const accountEntry = () => fixture("getLedgerEntries.account.json");

/** A trustline entry, as the `trust` simulation's state changes recorded the one it would create. */
function trustlineEntry(): { entries: unknown[]; latestLedger: number } {
  const changes = fixture<{ stateChanges: Array<{ type: string; key: string; after: string | null }> }>("simulateTransaction.usdc-trust.json").stateChanges;
  const created = changes.find((change) => change.type === "created")!;
  const entry = xdr.LedgerEntry.fromXDR(created.after!, "base64");
  return { entries: [{ key: created.key, xdr: entry.data().toXDR("base64"), lastModifiedLedgerSeq: 4763793 }], latestLedger: 4763793 };
}

describe("the endpoint check", () => {
  it("refuses an endpoint on another network before anything is read", async () => {
    mock.on("getNetwork", () => pubnet);
    const error = await connectSquareClient({ deployment, rpc: mock.url, allowHttp: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeploymentNetworkMismatchError);
    expect((error as DeploymentNetworkMismatchError).source).toBe("endpoint");
    expect((error as DeploymentNetworkMismatchError).actualPassphrase).toBe(Networks.PUBLIC);
    expect(mock.calls("simulateTransaction")).toHaveLength(0);
  });

  it("asks once, and retries after a transport failure rather than caching it", async () => {
    mock.fail("getNetwork", -32603, "down");
    const square = client();
    await expect(square.latestLedger()).rejects.toThrow();
    mock.on("getNetwork", () => testnet);
    mock.on("getHealth", () => ({ status: "healthy", latestLedger: 4761085, oldestLedger: 4640071, ledgerRetentionWindow: 120960 }));
    expect(await square.latestLedger()).toBe(4761085);
    expect(await square.latestLedger()).toBe(4761085);
    expect(mock.calls("getNetwork")).toHaveLength(2);
  });

  it("refuses a signer bound to another network at construction", () => {
    expect(() => createSquareClient({ deployment, rpc: mock.url, allowHttp: true, signer: keypairSigner(keypair, Networks.PUBLIC) })).toThrow(DeploymentNetworkMismatchError);
    try {
      createSquareClient({ deployment, rpc: mock.url, allowHttp: true, signer: keypairSigner(keypair, Networks.PUBLIC) });
    } catch (error) {
      expect((error as DeploymentNetworkMismatchError).source).toBe("declared");
    }
  });

  it("needs an endpoint for a network with no default one", () => {
    expect(() => createSquareClient({ deployment: { ...deployment, network: "stellar:pubnet", networkPassphrase: Networks.PUBLIC } })).toThrow(/pass rpc/);
  });
});

describe("read", () => {
  it("simulates the call from no account and answers the return value", async () => {
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-decimals.json"));
    const decimals = await client().read<number>({ contract: "usdc", method: "decimals" });
    expect(decimals).toBe(7);
    const [request] = mock.calls("simulateTransaction");
    const envelope = TransactionBuilder.fromXDR(request!.params!["transaction"] as string, Networks.TESTNET);
    if (!(envelope instanceof Transaction)) throw new Error("not a transaction");
    expect(envelope.operations).toHaveLength(1);
    expect(envelope.source).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    const invocation = envelope.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(Address.fromScAddress(invocation.contractAddress()).toString()).toBe(USDC_SAC);
    expect(invocation.functionName().toString()).toBe("decimals");
    expect(mock.calls("getLedgerEntries")).toHaveLength(0);
  });

  it("throws the contract's own error, decoded, when the simulation refuses", async () => {
    mock.on("simulateTransaction", () => fixture("simulateTransaction.trustline-missing.json"));
    const error = await client()
      .read({ contract: "usdc", method: "balance", args: [nativeToScVal(Keypair.random().publicKey(), { type: "address" })] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SquareContractError);
    const refused = error as SquareContractError;
    expect(refused.contract).toBe("usdc");
    expect(refused.method).toBe("balance");
    expect(refused.code).toBe(13);
    expect(refused.errorName).toBe("TrustlineMissingError");
    expect(refused.detail).toBe("trustline entry is missing for account");
    expect(refused.message).toMatch(/^usdc\.balance: usdc refused with TrustlineMissingError \(#13\)/);
    expect(mock.calls("sendTransaction")).toHaveLength(0);
  });

  it("cannot restore archived entries, and says so", async () => {
    const ok = fixture<Record<string, unknown>>("simulateTransaction.usdc-decimals.json");
    mock.on("simulateTransaction", () => ({ ...ok, restorePreamble: { minResourceFee: "1", transactionData: ok["transactionData"] } }));
    await expect(client().read({ contract: "usdc", method: "decimals" })).rejects.toThrow(ArchivedStateError);
  });

  it("calls any contract by id, named when the deployment names it", async () => {
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-decimals.json"));
    expect(await client().read({ contract: { id: USDC_SAC }, method: "decimals" })).toBe(7);
    expect(client().resolve({ id: USDC_SAC })).toEqual({ id: USDC_SAC, name: "usdc" });
    expect(client().resolve({ id: other(1) })).toEqual({ id: other(1), name: "square_job" });
    expect(client().resolve({ id: other(40), name: "probe" })).toEqual({ id: other(40), name: "probe" });
    expect(() => client().resolve("compliance_module")).toThrow(/names no compliance_module/);
  });
});

describe("write", () => {
  it("needs a signer", async () => {
    await expect(client().write({ contract: "usdc", method: "trust", args: [] })).rejects.toThrow(WalletRequiredError);
    expect(() => client().account).toThrow(WalletRequiredError);
    expect(client({ signer: true }).account).toBe(keypair.publicKey());
  });

  it("simulates, signs, sends and answers with the ledger, the events and the fee", async () => {
    mock.on("getLedgerEntries", accountEntry);
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-trust.json"));
    mock.on("sendTransaction", () => ({ status: "PENDING", hash: FUND_TX, latestLedger: 4763793, latestLedgerCloseTime: 1789828737 }));
    let polls = 0;
    mock.on("getTransaction", () => (polls++ === 0 ? { status: "NOT_FOUND", txHash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1 } : fixture("getTransaction.fund.json")));

    const result = await client({ signer: true }).trustUsdc();
    expect(result).not.toBeNull();
    expect(result!.hash).toBe(FUND_TX);
    expect(result!.ledger).toBe(4760307);
    expect(result!.feeCharged).toBe(188_125n);
    expect(result!.result).toBeUndefined();
    expect(result!.events.map((event) => [event.contract, event.name])).toEqual([]);
    expect(polls).toBe(2);

    // What went out: the simulation's footprint and authorization on an envelope this signer signed.
    const [sent] = mock.calls("sendTransaction");
    const envelope = TransactionBuilder.fromXDR(sent!.params!["transaction"] as string, Networks.TESTNET);
    if (!(envelope instanceof Transaction)) throw new Error("not a transaction");
    expect(envelope.source).toBe(keypair.publicKey());
    expect(envelope.signatures).toHaveLength(1);
    expect(keypair.verify(envelope.hash(), envelope.signatures[0]!.signature())).toBe(true);
    const simulated = fixture<{ transactionData: string; results: Array<{ auth: string[] }> }>("simulateTransaction.usdc-trust.json");
    expect(envelope.toEnvelope().v1().tx().ext().sorobanData().toXDR("base64")).toBe(simulated.transactionData);
    const operation = envelope.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp();
    expect(operation.auth().map((entry) => entry.toXDR("base64"))).toEqual(simulated.results[0]!.auth);
    expect(operation.hostFunction().invokeContract().functionName().toString()).toBe("trust");
    expect(scValToNative(operation.hostFunction().invokeContract().args()[0]!)).toBe(keypair.publicKey());
  });

  it("decodes the events of the deployment's contracts from the transaction", async () => {
    // The fund transaction moved XLM through the native SAC; naming that SAC as the token makes its transfer the deployment's.
    const xlm = { ...deployment, usdc: { ...deployment.usdc, contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" } };
    mock.on("getTransaction", () => fixture("getTransaction.fund.json"));
    const square = createSquareClient({ deployment: xlm, rpc: mock.url, allowHttp: true });
    const result = await square.getTransaction(FUND_TX);
    expect(result?.events.map((event) => [event.contract, event.name, event.data])).toEqual([["usdc", "transfer", 10_000_000n]]);
    expect(result?.result).toBeNull();
  });

  it("answers null for a transaction the network has not seen", async () => {
    mock.on("getTransaction", () => ({ status: "NOT_FOUND", txHash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1 }));
    expect(await client().getTransaction(FUND_TX)).toBeNull();
  });

  it("throws when the network refuses the submission", async () => {
    mock.on("getLedgerEntries", accountEntry);
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-trust.json"));
    mock.on("sendTransaction", () => ({ status: "ERROR", hash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1, errorResultXdr: "AAAAAAAAAGT////7AAAAAA==" }));
    const error = await client({ signer: true }).trustUsdc().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionSendError);
    expect((error as TransactionSendError).status).toBe("ERROR");
    expect((error as TransactionSendError).hash).toBe(FUND_TX);
    expect(mock.calls("getTransaction")).toHaveLength(0);
  });

  it("throws when the transaction failed in its ledger", async () => {
    mock.on("getLedgerEntries", accountEntry);
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-trust.json"));
    mock.on("sendTransaction", () => ({ status: "PENDING", hash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1 }));
    mock.on("getTransaction", () => ({ ...fixture<Record<string, unknown>>("getTransaction.fund.json"), status: "FAILED" }));
    const error = await client({ signer: true }).trustUsdc().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect((error as TransactionFailedError).hash).toBe(FUND_TX);
    expect((error as TransactionFailedError).ledger).toBe(4760307);
    await expect(client().getTransaction(FUND_TX)).rejects.toThrow(TransactionFailedError);
  });

  it("gives up waiting after the timeout, naming the hash", async () => {
    mock.on("getLedgerEntries", accountEntry);
    mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-trust.json"));
    mock.on("sendTransaction", () => ({ status: "PENDING", hash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1 }));
    mock.on("getTransaction", () => ({ status: "NOT_FOUND", txHash: FUND_TX, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1 }));
    const error = await client({ signer: true, timeoutInSeconds: 1 }).trustUsdc().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionPendingError);
    expect((error as TransactionPendingError).hash).toBe(FUND_TX);
    expect(mock.calls("getTransaction").length).toBeGreaterThan(1);
  });

  it("does nothing for a contract signer, which needs no trustline", async () => {
    const contractSigner = { ...signer, address: other(30) };
    expect(await createSquareClient({ deployment, rpc: mock.url, allowHttp: true, signer: contractSigner }).trustUsdc()).toBeNull();
    expect(mock.requests).toHaveLength(0);
  });
});

describe("USDC", () => {
  it("reads a trustline off the ledger", async () => {
    mock.on("getLedgerEntries", trustlineEntry);
    const square = client();
    expect(await square.usdcTrustline(keypair.publicKey())).toEqual({ status: "open", balance: 0n, limit: 9223372036854775807n, authorized: true });
    expect(await square.hasUsdcTrustline(keypair.publicKey())).toBe(true);
    expect(await square.usdcBalance(keypair.publicKey())).toBe(0n);
    await expect(square.assertUsdcReceivable(keypair.publicKey())).resolves.toBeUndefined();
    const [request] = mock.calls("getLedgerEntries");
    const key = xdr.LedgerKey.fromXDR((request!.params!["keys"] as string[])[0]!, "base64");
    expect(key.switch()).toBe(xdr.LedgerEntryType.trustline());
    expect(key.trustLine().asset().alphaNum4().assetCode().toString().replace(/\0+$/, "")).toBe("USDC");
  });

  it("tells a missing trustline from an empty one", async () => {
    mock.on("getLedgerEntries", () => ({ entries: [], latestLedger: 1 }));
    const square = client();
    expect(await square.usdcTrustline(keypair.publicKey())).toEqual({ status: "missing" });
    expect(await square.hasUsdcTrustline(keypair.publicKey())).toBe(false);
    expect(await square.usdcBalance(keypair.publicKey())).toBe(0n);
    const error = await square.assertUsdcReceivable(keypair.publicKey()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrustlineMissingError);
    expect((error as TrustlineMissingError).account).toBe(keypair.publicKey());
    expect((error as TrustlineMissingError).asset).toBe(`USDC:${USDC_ISSUER}`);
  });

  it("needs no trustline for a contract, whose balance is the SAC's entry", async () => {
    const holder = other(12);
    const square = client();
    expect(await square.usdcTrustline(holder)).toEqual({ status: "contract" });
    await expect(square.assertUsdcReceivable(holder)).resolves.toBeUndefined();
    mock.on("getLedgerEntries", () => ({ entries: [], latestLedger: 1 }));
    expect(await square.usdcBalance(holder)).toBe(0n);
    const balance = xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({
        ext: new xdr.ExtensionPoint(0),
        contract: Address.fromString(USDC_SAC).toScAddress(),
        key: nativeToScVal(["Balance", holder], { type: ["symbol", "address"] }),
        durability: xdr.ContractDataDurability.persistent(),
        val: nativeToScVal({ amount: 15_000_000n, authorized: true, clawback: false }, { type: { amount: ["symbol", "i128"], authorized: ["symbol"], clawback: ["symbol"] } }),
      }),
    );
    mock.on("getLedgerEntries", (params) => ({ entries: [{ key: (params!["keys"] as string[])[0], xdr: balance.toXDR("base64"), lastModifiedLedgerSeq: 1 }], latestLedger: 1 }));
    expect(await square.usdcBalance(holder)).toBe(15_000_000n);
  });

  it("refuses an address that is neither", async () => {
    await expect(client().usdcTrustline("0x3600000000000000000000000000000000000000")).rejects.toThrow(/not a Stellar account/);
  });
});

describe("clientOptions", () => {
  it("hand a bindings client this client's endpoint, network, signer and error table", () => {
    const options = client({ signer: true }).clientOptions("usdc");
    expect(options.contractId).toBe(USDC_SAC);
    expect(options.networkPassphrase).toBe(Networks.TESTNET);
    expect(options.rpcUrl).toBe(mock.url);
    expect(options.publicKey).toBe(keypair.publicKey());
    expect(options.signTransaction).toBe(signer);
    expect(options.errorTypes?.[13]).toEqual({ message: "TrustlineMissingError" });
    expect(client().clientOptions("square_job")).not.toHaveProperty("publicKey");
    expect(client().clientOptions("square_job")).not.toHaveProperty("errorTypes");
  });
});
