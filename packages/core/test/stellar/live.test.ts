import { Keypair, nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  connectSquareClient,
  formatXlm,
  isContractAddress,
  issuedToken,
  JobStatus,
  kernelEvent,
  keypairSigner,
  nativeToken,
  networkFor,
  SquareContractError,
  TrustlineMissingError,
  type SquareDeployment,
} from "../../src/stellar/index.js";

/**
 * The client against Stellar testnet itself, with `STELLAR_LIVE=1`: the
 * endpoint check, a read of the USDC SAC, a refusal decoded, and one real
 * write, `trust`, from an account made for this run and funded by Friendbot.
 * Its secret lives only in this process. The deployment names USDC as the
 * token, so the trustline paths run, and placeholder ids for the rest.
 *
 * With `STELLAR_KERNEL=C…` as well, a `square_job` deployed on testnet with
 * native XLM as its token: the whole MVP lifecycle runs against it from two
 * fresh Friendbot accounts, a client and a provider. It needs the kernel's
 * challenge window to be short (the test waits it out, up to two minutes).
 */
const live = process.env["STELLAR_LIVE"] === "1";
const kernel = process.env["STELLAR_KERNEL"];
const testnet = networkFor("stellar:testnet");
const placeholder = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));

const deployment: SquareDeployment = {
  network: "stellar:testnet",
  networkPassphrase: testnet.networkPassphrase,
  squareJob: placeholder(1),
  keeperEvaluator: placeholder(2),
  arbitration: placeholder(3),
  claimMarket: placeholder(4),
  squareHook: placeholder(5),
  policyRegistry: placeholder(6),
  token: issuedToken("USDC", testnet.usdc!.issuer, testnet.networkPassphrase),
  usdc: testnet.usdc!,
  identityRegistry: placeholder(7),
  reputationRegistry: placeholder(8),
  validationRegistry: placeholder(9),
};

async function friendbot(account: string): Promise<void> {
  const funded = await fetch(`${testnet.friendbotUrl}/?addr=${account}`);
  if (!funded.ok) throw new Error(`friendbot refused ${account}: ${funded.status}`);
}

describe.skipIf(!live)("Stellar testnet", () => {
  const keypair = Keypair.random();

  it("is the network the deployment is for, and reads the USDC SAC", async () => {
    const square = await connectSquareClient({ deployment });
    expect(await square.latestLedger()).toBeGreaterThan(4_760_000);
    expect(await square.read({ contract: "usdc", method: "decimals" })).toBe(7);
    expect(await square.read({ contract: "usdc", method: "symbol" })).toBe("USDC");
    expect(await square.read({ contract: "usdc", method: "name" })).toBe(`USDC:${testnet.usdc!.issuer}`);
  });

  it("decodes the SAC's refusal of a balance read for an account with no trustline", async () => {
    const square = await connectSquareClient({ deployment });
    const error = await square.read({ contract: "usdc", method: "balance", args: [nativeToScVal(keypair.publicKey(), { type: "address" })] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SquareContractError);
    expect((error as SquareContractError).errorName).toBe("TrustlineMissingError");
    expect((error as SquareContractError).raisedBy).toBe("token");
  });

  it("opens a USDC trustline for a fresh account with one signed invocation", async () => {
    await friendbot(keypair.publicKey());
    const square = await connectSquareClient({ deployment, signer: keypairSigner(keypair, testnet.networkPassphrase) });

    expect(await square.trustline(keypair.publicKey())).toEqual({ status: "missing" });
    await expect(square.assertReceivable(keypair.publicKey())).rejects.toThrow(TrustlineMissingError);
    expect(await square.tokenBalance(keypair.publicKey())).toBe(0n);

    const result = await square.trustToken();
    expect(result).not.toBeNull();
    expect(result!.ledger).toBeGreaterThan(0);
    expect(result!.feeCharged).toBeGreaterThan(0n);
    expect(result!.events).toEqual([]);
    console.info(`trust: tx ${result!.hash} ledger ${result!.ledger} fee ${formatXlm(result!.feeCharged)} XLM ${testnet.explorerUrl}/tx/${result!.hash}`);

    expect(await square.trustline(keypair.publicKey())).toMatchObject({ status: "open", balance: 0n, authorized: true });
    await expect(square.assertReceivable(keypair.publicKey())).resolves.toBeUndefined();
    expect(await square.read({ contract: "usdc", method: "balance", args: [nativeToScVal(keypair.publicKey(), { type: "address" })] })).toBe(0n);
    expect(await square.getTransaction(result!.hash)).toMatchObject({ hash: result!.hash, ledger: result!.ledger });
  }, 120_000);
});

describe.skipIf(!live || !kernel)("the kernel on Stellar testnet", () => {
  const xlm: SquareDeployment = {
    network: "stellar:testnet",
    networkPassphrase: testnet.networkPassphrase,
    squareJob: kernel ?? placeholder(1),
    token: nativeToken(testnet.networkPassphrase),
  };
  const clientKey = Keypair.random();
  const providerKey = Keypair.random();
  const budget = 25_000_000n; // 2.5 XLM

  it("runs the MVP lifecycle: create, price, fund, submit, wait, finalize, withdraw", async () => {
    expect(isContractAddress(kernel!)).toBe(true);
    await Promise.all([friendbot(clientKey.publicKey()), friendbot(providerKey.publicKey())]);
    const client = await connectSquareClient({ deployment: xlm, signer: keypairSigner(clientKey, testnet.networkPassphrase) });
    const provider = await connectSquareClient({ deployment: xlm, signer: keypairSigner(providerKey, testnet.networkPassphrase) });
    const anyone = await connectSquareClient({ deployment: xlm });

    const config = await anyone.kernelConfig();
    expect(config.token).toBe(xlm.token.contractId);
    expect(config.challengeWindow).toBeLessThanOrEqual(120n);
    const before = await anyone.jobCounter();
    const balanceBefore = await client.tokenBalance(clientKey.publicKey());

    // The client opens the job; the provider prices it; the client accepts the price by funding.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const created = await client.createJob({ provider: providerKey.publicKey(), expiredAt: now + 3600n, description: "live: summarise the quarterly report" });
    const jobId = created.result;
    expect(jobId).toBe(before + 1n);
    expect(kernelEvent(created.events, "job_created")).toMatchObject({ jobId, client: clientKey.publicKey(), provider: providerKey.publicKey() });
    console.info(`create_job: job ${jobId} tx ${created.hash} fee ${formatXlm(created.feeCharged)} XLM`);

    await provider.setBudget(jobId, budget);
    expect((await anyone.getJob(jobId)).budget).toBe(budget);
    const funded = await client.fund(jobId, budget);
    expect(kernelEvent(funded.events, "funded")).toMatchObject({ jobId, amount: budget });
    // The SAC's transfer beneath fund is the token's event, under the same signature.
    expect(funded.events.some((event) => event.contract === "token" && event.name === "transfer")).toBe(true);
    expect((await anyone.getJob(jobId)).status).toBe(JobStatus.Funded);
    expect(await anyone.tokenBalance(kernel!)).toBeGreaterThanOrEqual(budget);
    console.info(`fund: tx ${funded.hash} fee ${formatXlm(funded.feeCharged)} XLM`);

    // A wrong budget, a stranger's submit, and an early finalize are refused in simulation, unsent.
    await expect(client.fund(jobId, budget)).rejects.toMatchObject({ errorName: "WrongStatus" });
    await expect(client.submit(jobId, "not the provider")).rejects.toMatchObject({ errorName: "NotProvider" });

    const submitted = await provider.submit(jobId, "the report, summarised");
    const event = kernelEvent(submitted.events, "submitted");
    expect(event).toBeDefined();
    const job = await anyone.getJob(jobId);
    expect(job.status).toBe(JobStatus.Submitted);
    expect(job.finalizeAfter).toBe(event!.finalizeAfter);
    console.info(`submit: tx ${submitted.hash}; finalize after ${job.finalizeAfter}`);

    // Inside the window nobody can finalize: refused in simulation, nothing sent.
    const early = await client.finalize(jobId).catch((e: unknown) => e);
    if (config.challengeWindow > 0n) expect(early).toMatchObject({ errorName: "WindowOpen", raisedBy: "square_job" });

    // Wait the window out, on the ledger's clock.
    for (;;) {
      const ledgerNow = BigInt(Math.floor(Date.now() / 1000));
      if (ledgerNow > job.finalizeAfter! + 5n) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    const finalized = await client.finalize(jobId); // anyone may; the client cranks it here
    const settled = kernelEvent(finalized.events, "finalized");
    expect(settled).toMatchObject({ jobId, provider: providerKey.publicKey() });
    expect(settled!.payout + settled!.fee).toBe(budget);
    expect((await anyone.getJob(jobId)).status).toBe(JobStatus.Completed);
    console.info(`finalize: tx ${finalized.hash} payout ${formatXlm(settled!.payout)} fee ${formatXlm(settled!.fee)} XLM`);

    // Pull payment: the provider takes its payout home.
    expect(await provider.withdrawable()).toBe(settled!.payout);
    const withdrawn = await provider.withdraw(settled!.payout);
    expect(kernelEvent(withdrawn.events, "withdrawn")).toMatchObject({ account: providerKey.publicKey(), to: providerKey.publicKey(), amount: settled!.payout });
    expect(await provider.withdrawable()).toBe(0n);
    await expect(provider.withdraw(1n)).rejects.toMatchObject({ errorName: "InsufficientBalance" });
    expect(await client.tokenBalance(clientKey.publicKey())).toBeLessThan(balanceBefore - budget);
    console.info(`withdraw: tx ${withdrawn.hash} ${testnet.explorerUrl}/contract/${kernel}`);
  }, 300_000);
});
