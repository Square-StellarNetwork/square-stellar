import { Address, Keypair, nativeToScVal, Networks, scValToNative, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSquareClient,
  decodeSquareEvents,
  deliverableHash,
  JOB_STATUS_NAMES,
  JobStatus,
  kernelEvent,
  kernelEvents,
  keypairSigner,
  MalformedEventError,
  nativeToken,
  SQUARE_JOB_ERRORS,
  SquareContractError,
  squareJobSpec,
  toSquareJob,
  TransactionSendError,
  WalletRequiredError,
  type JobRecord,
  type SquareClient,
  type SquareDeployment,
} from "../../src/stellar/index.js";
import { fixture, startMockRpc, type MockRpc } from "./rpcMock.js";

/**
 * The kernel's methods against the stand-in RPC: what each one asks the
 * kernel (the invocation the simulation request carries, decoded), what a
 * read answers from a return value encoded with the bindings' own spec, and
 * the typed events. The simulation answers are the captured `trust` one,
 * whose source-account authorization fits any signer; the write pipeline
 * itself is client.test.ts's. The lifecycle against a real kernel is
 * live.test.ts's (`STELLAR_LIVE=1 STELLAR_KERNEL=C…`).
 */
const KERNEL = StrKey.encodeContract(Buffer.alloc(32, 1));
const deployment: SquareDeployment = {
  network: "stellar:testnet",
  networkPassphrase: Networks.TESTNET,
  squareJob: KERNEL,
  token: nativeToken(Networks.TESTNET),
};

const clientKey = Keypair.random();
const provider = Keypair.random().publicKey();
const signer = keypairSigner(clientKey, Networks.TESTNET);
const testnet = { friendbotUrl: "https://friendbot.stellar.org/", passphrase: Networks.TESTNET, protocolVersion: 28 };

let mock: MockRpc;
beforeEach(async () => {
  mock = await startMockRpc();
  mock.on("getNetwork", () => testnet);
});
afterEach(() => mock.close());

const square = (withSigner = true): SquareClient => createSquareClient({ deployment, rpc: mock.url, allowHttp: true, signer: withSigner ? signer : undefined });

/** A simulation answering `value` as the return value. */
function answering(value: xdr.ScVal): Record<string, unknown> {
  const base = fixture<{ results: Array<Record<string, unknown>> }>("simulateTransaction.usdc-decimals.json");
  return { ...base, results: [{ ...base.results[0], xdr: value.toXDR("base64") }] };
}

/** The invocation the last simulation request carried: which contract, which function, which arguments. */
function lastInvocation(): { contract: string; method: string; args: unknown[]; source: string } {
  const [request] = mock.calls("simulateTransaction").slice(-1);
  const envelope = TransactionBuilder.fromXDR(request!.params!["transaction"] as string, Networks.TESTNET);
  if (!(envelope instanceof Transaction)) throw new Error("not a transaction");
  const invocation = envelope.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().hostFunction().invokeContract();
  return {
    contract: Address.fromScAddress(invocation.contractAddress()).toString(),
    method: invocation.functionName().toString(),
    args: invocation.args().map((arg) => scValToNative(arg)),
    source: envelope.source,
  };
}

/**
 * Runs a write up to the point the network refuses it, and answers what it
 * asked the kernel: the simulation passed (the trust fixture), the send was
 * refused, so the client threw `TransactionSendError` after encoding
 * everything.
 */
async function writeAsked(call: () => Promise<unknown>): Promise<ReturnType<typeof lastInvocation>> {
  mock.on("getLedgerEntries", () => fixture("getLedgerEntries.account.json"));
  mock.on("simulateTransaction", () => fixture("simulateTransaction.usdc-trust.json"));
  mock.on("sendTransaction", () => ({ status: "ERROR", hash: "00", latestLedger: 1, latestLedgerCloseTime: 1, errorResultXdr: "AAAAAAAAAGT////7AAAAAA==" }));
  await expect(call()).rejects.toThrow(TransactionSendError);
  return lastInvocation();
}

const record = (over: Partial<JobRecord> = {}): JobRecord => ({
  client: clientKey.publicKey(),
  provider,
  status: JobStatus.Submitted,
  budget: 25_000_000n,
  platform_fee_bps: 250,
  challenge_window: 600n,
  created_at: 1_789_776_000n,
  expired_at: 1_789_862_400n,
  funded_at: 1_789_776_100n,
  submitted_at: 1_789_779_600n,
  deliverable: Buffer.alloc(32, 7),
  description: "summarise the quarterly report",
  ...over,
});

const jobType = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "Job" }));

describe("the error table", () => {
  it("is the bindings': the kernel's codes and the owner's, by number", () => {
    expect(SQUARE_JOB_ERRORS[1]).toBe("InvalidJob");
    expect(SQUARE_JOB_ERRORS[13]).toBe("NotExpired");
    expect(SQUARE_JOB_ERRORS[19]).toBe("InvalidTtlConfig");
    expect(SQUARE_JOB_ERRORS[100]).toBe("NoPendingOffer");
    expect(SQUARE_JOB_ERRORS[102]).toBe("SameOwner");
    expect(Object.keys(SQUARE_JOB_ERRORS)).toHaveLength(22);
  });

  it("names a refusal from the kernel by the kernel's table, not the token's", async () => {
    // The captured refusal is the SAC's #13; re-addressed to the kernel it reads as NotExpired, the kernel's #13.
    const refusal = fixture<{ events: string[] }>("simulateTransaction.trustline-missing.json");
    const events = refusal.events.map((event) => {
      const diagnostic = xdr.DiagnosticEvent.fromXDR(event, "base64");
      if (diagnostic.event().contractId() !== null) diagnostic.event().contractId(Address.fromString(KERNEL).toScAddress().contractId());
      return diagnostic.toXDR("base64");
    });
    mock.on("simulateTransaction", () => ({ ...refusal, events }));
    mock.on("getLedgerEntries", () => fixture("getLedgerEntries.account.json"));
    const error = await square(false).claimRefund(1n).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletRequiredError);
    const refused = await square().claimRefund(1n).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SquareContractError);
    expect((refused as SquareContractError).errorName).toBe("NotExpired");
    expect((refused as SquareContractError).raisedBy).toBe("square_job");
  });
});

describe("reads", () => {
  it("getJob decodes the record through the spec and works out the settlement moment", async () => {
    mock.on("simulateTransaction", () => answering(squareJobSpec.nativeToScVal(record(), jobType)));
    const job = await square(false).getJob(9n);
    expect(job).toEqual({
      id: 9n,
      client: clientKey.publicKey(),
      provider,
      status: JobStatus.Submitted,
      budget: 25_000_000n,
      platformFeeBps: 250,
      challengeWindow: 600n,
      createdAt: 1_789_776_000n,
      expiredAt: 1_789_862_400n,
      fundedAt: 1_789_776_100n,
      submittedAt: 1_789_779_600n,
      deliverable: new Uint8Array(32).fill(7),
      description: "summarise the quarterly report",
      finalizeAfter: 1_789_779_600n + 600n,
    });
    expect(JOB_STATUS_NAMES[job.status]).toBe("Submitted");
    const asked = lastInvocation();
    expect(asked).toMatchObject({ contract: KERNEL, method: "get_job", args: [9n] });
    expect(asked.source).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  });

  it("getJob of an Open job has no deliverable and no settlement moment", async () => {
    mock.on("simulateTransaction", () => answering(squareJobSpec.nativeToScVal(record({ status: JobStatus.Open, submitted_at: 0n, funded_at: 0n, deliverable: undefined }), jobType)));
    const job = await square(false).getJob(1n);
    expect(job.status).toBe(JobStatus.Open);
    expect(job.deliverable).toBeUndefined();
    expect(job.finalizeAfter).toBeUndefined();
  });

  it("withdrawable, jobCounter, kernelConfig, kernelOwner and kernelTotals ask the kernel and answer natives", async () => {
    mock.on("simulateTransaction", () => answering(xdr.ScVal.scvU64(new xdr.Uint64(42n))));
    expect(await square().withdrawable()).toBe(42n);
    expect(lastInvocation()).toMatchObject({ method: "withdrawable", args: [clientKey.publicKey()] });
    expect(await square(false).withdrawable(provider)).toBe(42n);
    expect(lastInvocation().args).toEqual([provider]);
    expect(await square(false).jobCounter()).toBe(42n);
    expect(lastInvocation()).toMatchObject({ method: "job_counter", args: [] });

    const owner = Keypair.random().publicKey();
    mock.on("simulateTransaction", () => answering(nativeToScVal(owner, { type: "address" })));
    expect(await square(false).kernelOwner()).toBe(owner);

    const configType = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "Config" }));
    mock.on("simulateTransaction", () => answering(squareJobSpec.nativeToScVal({ token: deployment.token.contractId, challenge_window: 600n, platform_fee_bps: 250 }, configType)));
    expect(await square(false).kernelConfig()).toEqual({ token: deployment.token.contractId, challengeWindow: 600n, platformFeeBps: 250 });

    mock.on("simulateTransaction", (params) => {
      const tx = TransactionBuilder.fromXDR(params!["transaction"] as string, Networks.TESTNET) as Transaction;
      const name = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().hostFunction().invokeContract().functionName().toString();
      return answering(name === "unaccounted" ? nativeToScVal(-3n, { type: "i128" }) : xdr.ScVal.scvU64(new xdr.Uint64(name === "total_escrowed" ? 10n : 20n)));
    });
    expect(await square(false).kernelTotals()).toEqual({ escrowed: 10n, withdrawable: 20n, unaccounted: -3n });
  });

  it("does not need a signer to read, and withdrawable() without one needs an account", async () => {
    await expect(square(false).withdrawable()).rejects.toThrow(WalletRequiredError);
  });
});

describe("writes ask the kernel with the signer as the acting address", () => {
  it("createJob", async () => {
    const asked = await writeAsked(() => square().createJob({ provider, expiredAt: 1_789_862_400, description: "translate the deck" }));
    expect(asked).toMatchObject({ contract: KERNEL, method: "create_job", args: [clientKey.publicKey(), provider, 1_789_862_400n, "translate the deck"], source: clientKey.publicKey() });
  });

  it("setBudget, fund and withdrawTo carry the amount as i128 and refuse one a record cannot hold", async () => {
    expect((await writeAsked(() => square().setBudget(7n, 25_000_000n))).args).toEqual([clientKey.publicKey(), 7n, 25_000_000n]);
    expect((await writeAsked(() => square().fund(7n, 25_000_000n))).args).toEqual([clientKey.publicKey(), 7n, 25_000_000n]);
    expect(await writeAsked(() => square().withdrawTo(provider, 5n))).toMatchObject({ method: "withdraw_to", args: [clientKey.publicKey(), provider, 5n] });
    expect(await writeAsked(() => square().withdraw(5n))).toMatchObject({ method: "withdraw_to", args: [clientKey.publicKey(), clientKey.publicKey(), 5n] });
    const requests = mock.requests.length;
    await expect(square().fund(7n, (1n << 64n))).rejects.toThrow(/exceeds the u64/);
    await expect(square().setBudget(7n, -1n)).rejects.toThrow(/negative/);
    await expect(square().withdrawTo("not an address", 1n)).rejects.toThrow(/not a Stellar/);
    expect(mock.requests).toHaveLength(requests);
  });

  it("submit hashes the content, or takes a 32-byte hash as it is", async () => {
    const hashed = deliverableHash("the report, summarised");
    expect(hashed).toHaveLength(32);
    expect(deliverableHash(hashed)).toEqual(hashed);
    expect(deliverableHash(new TextEncoder().encode("the report, summarised"))).toEqual(hashed);
    expect(deliverableHash("something else")).not.toEqual(hashed);
    const asked = await writeAsked(() => square().submit(7n, "the report, summarised"));
    expect(asked.method).toBe("submit");
    expect(asked.args[0]).toBe(clientKey.publicKey());
    expect(asked.args[1]).toBe(7n);
    expect(new Uint8Array(asked.args[2] as Buffer)).toEqual(hashed);
  });

  it("finalize and claimRefund carry no signer, only the job; reject carries the reason", async () => {
    expect(await writeAsked(() => square().finalize(3n))).toMatchObject({ method: "finalize", args: [3n] });
    expect(await writeAsked(() => square().claimRefund(3n))).toMatchObject({ method: "claim_refund", args: [3n] });
    expect(await writeAsked(() => square().reject(3n, "wrong language"))).toMatchObject({ method: "reject", args: [clientKey.publicKey(), 3n, "wrong language"] });
  });

  it("need a signer", async () => {
    await expect(square(false).finalize(1n)).rejects.toThrow(WalletRequiredError);
    await expect(square(false).createJob({ provider, expiredAt: 1n, description: "" })).rejects.toThrow(WalletRequiredError);
    expect(mock.calls("simulateTransaction")).toHaveLength(0);
  });
});

describe("kernel events", () => {
  const jobId = 5n;
  const client = clientKey.publicKey();
  const event = (topics: xdr.ScVal[], data: xdr.ScVal, contract: string = KERNEL): xdr.ContractEvent =>
    new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: Address.fromString(contract).toScAddress().contractId(),
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
    });
  const sym = (s: string) => xdr.ScVal.scvSymbol(s);
  const u64 = (n: bigint) => xdr.ScVal.scvU64(new xdr.Uint64(n));
  const addr = (a: string) => nativeToScVal(a, { type: "address" });
  const map = (fields: Record<string, xdr.ScVal>) =>
    xdr.ScVal.scvMap(
      Object.entries(fields)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val })),
    );

  it("read the kernel's events into typed objects and leave the rest", () => {
    const raw = [
      event([sym("job_created"), u64(jobId), addr(client), addr(provider)], map({ expired_at: u64(2n), challenge_window: u64(600n), platform_fee_bps: nativeToScVal(250, { type: "u32" }), description: nativeToScVal("x", { type: "string" }) })),
      event([sym("transfer"), addr(client), addr(KERNEL), nativeToScVal("native", { type: "string" })], nativeToScVal(25_000_000n, { type: "i128" }), deployment.token.contractId),
      event([sym("funded"), u64(jobId), addr(client)], map({ amount: u64(25_000_000n) })),
      event([sym("submitted"), u64(jobId), addr(provider)], map({ deliverable: xdr.ScVal.scvBytes(Buffer.alloc(32, 7)), submitted_at: u64(10n), finalize_after: u64(610n) })),
      event([sym("finalized"), u64(jobId), addr(provider)], map({ payout: u64(24_375_000n), fee: u64(625_000n) })),
      event([sym("rejected"), u64(jobId), addr(client)], map({ refund: u64(0n), reason: nativeToScVal("no", { type: "string" }) })),
      event([sym("refunded"), u64(jobId), addr(client)], map({ amount: u64(1n) })),
      event([sym("withdrawn"), addr(provider), addr(client)], map({ amount: u64(2n) })),
      event([sym("skimmed"), addr(client)], map({ amount: u64(3n) })),
      event([sym("ownership_offered"), addr(client), addr(provider)], map({ live_until_ledger: nativeToScVal(99, { type: "u32" }) })),
      event([sym("ownership_transferred"), addr(client), addr(provider)], map({})),
      event([sym("something_new"), u64(jobId)], map({})),
    ];
    const decoded = decodeSquareEvents(raw, deployment);
    expect(decoded).toHaveLength(12);
    const typed = kernelEvents(decoded);
    expect(typed.map((e) => e.name)).toEqual(["job_created", "funded", "submitted", "finalized", "rejected", "refunded", "withdrawn", "skimmed", "ownership_offered", "ownership_transferred"]);
    expect(typed[0]).toMatchObject({ jobId, client, provider, expiredAt: 2n, challengeWindow: 600n, platformFeeBps: 250, description: "x", position: { operation: 0, index: 0 } });
    expect(kernelEvent(decoded, "submitted")).toMatchObject({ jobId, provider, deliverable: new Uint8Array(32).fill(7), submittedAt: 10n, finalizeAfter: 610n });
    expect(kernelEvent(decoded, "finalized")).toMatchObject({ payout: 24_375_000n, fee: 625_000n });
    expect(kernelEvent(decoded, "withdrawn")).toMatchObject({ account: provider, to: client, amount: 2n });
    expect(kernelEvent(decoded, "ownership_offered")).toMatchObject({ from: client, to: provider, liveUntilLedger: 99 });
    expect(kernelEvent(decoded, "budget_set")).toBeUndefined();
  });

  it("refuse a kernel event whose shape is not the contract's", () => {
    const wrong = decodeSquareEvents([event([sym("funded"), u64(jobId), addr(client)], map({ amount: nativeToScVal("25", { type: "string" }) }))], deployment);
    expect(() => kernelEvents(wrong)).toThrow(MalformedEventError);
    expect(() => kernelEvents(wrong)).toThrow(/data\.amount is string/);
    const noMap = decodeSquareEvents([event([sym("funded"), u64(jobId), addr(client)], u64(1n))], deployment);
    expect(() => kernelEvents(noMap)).toThrow(/data is not a map/);
  });
});

describe("toSquareJob", () => {
  it("keeps the record's numbers as bigints and the enum as the contract's", () => {
    const job = toSquareJob(1n, record({ status: JobStatus.Expired }));
    expect(job.status).toBe(5);
    expect(JOB_STATUS_NAMES[job.status]).toBe("Expired");
    expect(typeof job.budget).toBe("bigint");
  });
});

describe("getEvents", () => {
  it("asks the endpoint for the kernel's events with typed topic filters and answers a decoded page", async () => {
    // The captured page holds the XLM SAC's transfer of the fund transaction; naming XLM as the token keeps it.
    mock.on("getEvents", () => fixture("getEvents.fund-transfer.json"));
    const page = await square(false).getEvents({
      topics: [[{ symbol: "job_created" }, "*", "*", { address: clientKey.publicKey() }], [{ symbol: "funded" }, { u64: 7n }]],
      startLedger: 4_760_000,
      limit: 50,
    });
    expect(page.cursor).toBe("0020445418718494719-4294967295");
    expect(page.latestLedger).toBe(4_761_085);
    expect(page.latestLedgerCloseTime).toBe(1_789_829_012n);
    expect(page.oldestLedger).toBe(4_640_126);
    // The page is decoded as the endpoint answered it; a real endpoint applies the filter, the stand-in does not.
    expect(page.events.map((e) => [e.contract, e.name])).toEqual([["token", "transfer"]]);

    const [request] = mock.calls("getEvents");
    const params = request!.params as { startLedger: number; pagination: { limit: number }; filters: Array<{ type: string; contractIds: string[]; topics: string[][] }> };
    expect(params.startLedger).toBe(4_760_000);
    expect(params.pagination.limit).toBe(50);
    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]).toMatchObject({ type: "contract", contractIds: [KERNEL] });
    const [created, funded] = params.filters[0]!.topics;
    expect(created!.map((t) => (t === "*" ? "*" : scValToNative(xdr.ScVal.fromXDR(t, "base64"))))).toEqual(["job_created", "*", "*", clientKey.publicKey()]);
    expect(funded!.map((t) => scValToNative(xdr.ScVal.fromXDR(t, "base64")))).toEqual(["funded", 7n]);
  });

  it("reads forward from a cursor, and takes one of cursor and startLedger", async () => {
    mock.on("getEvents", () => fixture("getEvents.fund-transfer.json"));
    await square(false).getEvents({ cursor: "0020445418718494719-4294967295" });
    const [request] = mock.calls("getEvents");
    expect((request!.params as { pagination: { cursor: string } }).pagination.cursor).toBe("0020445418718494719-4294967295");
    expect(request!.params).not.toHaveProperty("startLedger");
    await expect(square(false).getEvents({})).rejects.toThrow(/one of the two/);
    await expect(square(false).getEvents({ cursor: "1", startLedger: 1 })).rejects.toThrow(/one of the two/);
  });

  it("decodes the token's events of a page when the token is asked for", async () => {
    mock.on("getEvents", () => fixture("getEvents.fund-transfer.json"));
    const page = await square(false).getEvents({ contract: "token", startLedger: 1 });
    expect(page.events.map((e) => [e.contract, e.name, e.data])).toEqual([["token", "transfer", 10_000_000n]]);
    expect(page.events[0]!.ledger).toBe(4_760_307);
  });
});
