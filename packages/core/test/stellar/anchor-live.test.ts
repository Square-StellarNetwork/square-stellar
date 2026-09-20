import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  AnchorNeedsMoreError,
  authenticateWithAnchor,
  connectSquareClient,
  discoverAnchor,
  issuedToken,
  keypairSigner,
  networkFor,
  quotePrice,
  Sep6Client,
  sep38Asset,
  type Sep6DepositInstructions,
  type Sep6Transaction,
  type SquareDeployment,
} from "../../src/stellar/index.js";

/**
 * The anchor client against the one TRY⇄USDC anchor on Stellar Testnet,
 * `tr-mock-anchor.fly.dev` (#58), with `STELLAR_LIVE=1`: its toml, a SEP-10
 * sign-in with a key made for the run, its SEP-6 info, a SEP-38 price, a
 * deposit request and the transaction it opens; then, since the anchor is a
 * sandbox that lets the fiat leg be simulated from its `more_info_url`, the
 * whole rail: the wallet opens its USDC trustline, the "bank transfer" is
 * simulated, and the USDC the anchor pays lands in the wallet. The anchor
 * calls itself a testnet sandbox where no real money moves, the way
 * Friendbot is for XLM.
 */
const live = process.env["STELLAR_LIVE"] === "1";
const ANCHOR = process.env["STELLAR_ANCHOR"] ?? "tr-mock-anchor.fly.dev";
const testnet = networkFor("stellar:testnet");

describe.skipIf(!live)("the TRY anchor on Stellar testnet", () => {
  it("is discovered, signs the wallet in, quotes, and opens a deposit", async () => {
    const anchor = await discoverAnchor(ANCHOR, { expectedNetwork: testnet.networkPassphrase });
    expect(anchor.transferServer).toBeDefined();
    const usdc = anchor.currencies.find((c) => c.code === "USDC");
    expect(usdc?.issuer).toBe(testnet.usdc!.issuer);
    expect(usdc?.anchorAsset).toBe("TRY");
    console.info(`[anchor] ${anchor.organization.name}: ${anchor.organization.description}`);

    const wallet = Keypair.random();
    const session = await authenticateWithAnchor(anchor, keypairSigner(wallet, testnet.networkPassphrase));
    expect(session.token.length).toBeGreaterThan(10);
    console.info(`[anchor] SEP-10 token for ${wallet.publicKey()}, expires ${session.expiresAt}`);

    const client = new Sep6Client(session);
    const info = await client.info();
    expect(info.deposit["USDC"]).toMatchObject({ enabled: true, authenticationRequired: true });
    expect(info.deposit["USDC"]!.fundingMethods).toContain("bank_account");

    if (anchor.quoteServer) {
      const price = await quotePrice(session, { sellAsset: sep38Asset.fiat("TRY"), buyAsset: sep38Asset.stellar("USDC", usdc!.issuer!), sellAmount: "1000" }).catch((e: unknown) => e);
      console.info(`[anchor] SEP-38 1000 TRY → ${price instanceof Error ? `refused: ${price.message}` : `${(price as { buyAmount: string }).buyAmount} USDC at ${(price as { price: string }).price}`}`);
    }

    const deposit: Sep6DepositInstructions | Error = await client.deposit({ assetCode: "USDC", type: "bank_account", amount: "100" }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (deposit instanceof AnchorNeedsMoreError) {
      console.info(`[anchor] deposit needs SEP-12 first: ${deposit.type} ${deposit.fields.join(", ")}`);
      expect(deposit.fields.length).toBeGreaterThan(0);
      return;
    }
    if (deposit instanceof Error) throw deposit;
    console.info(`[anchor] deposit ${deposit.id}: ${deposit.how ?? JSON.stringify(deposit.instructions)}`);
    expect(deposit.id).toBeDefined();
    const transaction = await client.transaction(deposit.id!);
    expect(transaction.kind).toBe("deposit");
    console.info(`[anchor] transaction ${transaction.id} is ${transaction.status}`);
    const listed = await client.transactions("USDC", { kind: "deposit" });
    expect(listed.some((t) => t.id === deposit.id)).toBe(true);
  }, 60_000);

  it("takes simulated TRY in and pays real testnet USDC to the wallet", async () => {
    const anchor = await discoverAnchor(ANCHOR, { expectedNetwork: testnet.networkPassphrase });
    const wallet = Keypair.random();
    const funded = await fetch(`${testnet.friendbotUrl}/?addr=${wallet.publicKey()}`);
    expect(funded.ok).toBe(true);

    // The wallet has to be able to hold USDC before the anchor can pay it: the trustline, through the SAC's own `trust`.
    const usdc = issuedToken("USDC", testnet.usdc!.issuer, testnet.networkPassphrase);
    const deployment: SquareDeployment = { network: "stellar:testnet", networkPassphrase: testnet.networkPassphrase, squareJob: StrKey.encodeContract(Buffer.alloc(32, 1)), token: usdc };
    const square = await connectSquareClient({ deployment, signer: keypairSigner(wallet, testnet.networkPassphrase) });
    expect(await square.trustToken()).not.toBeNull();
    expect(await square.tokenBalance(wallet.publicKey())).toBe(0n);

    const session = await authenticateWithAnchor(anchor, keypairSigner(wallet, testnet.networkPassphrase));
    const client = new Sep6Client(session);
    const deposit = await client.deposit({ assetCode: "USDC", type: "bank_account", amount: "250" });
    const opened = await client.transaction(deposit.id!);
    expect(opened.status).toBe("pending_user_transfer_start");
    if (!opened.moreInfoUrl || !opened.moreInfoUrl.includes("/sep6/tx/")) {
      console.info(`[anchor] ${ANCHOR} offers no sandbox page to simulate the transfer; stopping at ${opened.status}`);
      return;
    }
    // The sandbox's "play the bank" button: what the customer's bank would do.
    const simulated = await fetch(`${opened.moreInfoUrl.replace(/\/$/, "")}/simulate-bank-transfer`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _: "1", amount: "250.00" }).toString(),
      redirect: "manual",
    });
    expect([200, 302, 303]).toContain(simulated.status);

    // The anchor took the (simulated) TRY: the deposit leaves the customer's step. Paying the USDC out is the
    // anchor's own worker; the sandbox has been seen to sit in pending_anchor for minutes, so that leg is
    // waited for, reported, and asserted only when it completes within the wait.
    const log = (t: { id: string; status: string; message: string | undefined }) => console.info(`[anchor] ${t.id} ${t.status}${t.message ? `: ${t.message}` : ""}`);
    const accepted = await client.follow(deposit.id!, { until: new Set(["pending_anchor", "pending_stellar", "completed", "error"]), intervalMs: 2_000, timeoutMs: 60_000, onStatus: log });
    expect(["pending_anchor", "pending_stellar", "completed"]).toContain(accepted.status);
    const done: Sep6Transaction | Error = await client.follow(deposit.id!, { intervalMs: 5_000, timeoutMs: 150_000, onStatus: log }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (done instanceof Error) {
      console.info(`[anchor] the anchor's USDC payout did not complete within the wait (${done.message}); the customer's side of the rail is done`);
      return;
    }
    expect(done.status).toBe("completed");
    const balance = await square.tokenBalance(wallet.publicKey());
    console.info(`[anchor] ${wallet.publicKey()} holds ${balance} USDC base units after the deposit (out: ${done.amountOut}, fee: ${done.amountFee}); tx ${done.stellarTransactionId}`);
    expect(balance).toBeGreaterThan(0n);
  }, 300_000);
});
