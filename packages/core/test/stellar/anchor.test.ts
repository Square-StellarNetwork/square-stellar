import { Keypair, Networks, Transaction, WebAuth } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AnchorError,
  AnchorNeedsMoreError,
  authenticateWithAnchor,
  discoverAnchor,
  keypairSigner,
  quotePrice,
  Sep6Client,
  sep38Asset,
  type Anchor,
} from "../../src/stellar/index.js";
import { startMockAnchor, type MockAnchor } from "./anchorMock.js";

/**
 * The anchor client against an anchor in a test (anchorMock.ts): real SEP-10
 * challenges signed by the mock's key and verified by it, SEP-6 answers in
 * the SEP's shapes. The real testnet anchor is anchor-live.test.ts's.
 */
let mock: MockAnchor;
beforeEach(async () => {
  mock = await startMockAnchor();
});
afterEach(() => mock.close());

const wallet = Keypair.random();
const signer = keypairSigner(wallet, Networks.TESTNET);

async function signIn(): Promise<{ anchor: Anchor; client: Sep6Client }> {
  const anchor = await discoverAnchor(mock.url);
  const session = await authenticateWithAnchor(anchor, signer);
  return { anchor, client: new Sep6Client(session) };
}

describe("SEP-1", () => {
  it("reads the anchor out of its stellar.toml", async () => {
    const anchor = await discoverAnchor(mock.url, { expectedNetwork: Networks.TESTNET });
    expect(anchor).toMatchObject({
      homeDomain: mock.homeDomain,
      signingKey: mock.serverKey.publicKey(),
      networkPassphrase: Networks.TESTNET,
      webAuthEndpoint: `${mock.url}/auth`,
      transferServer: `${mock.url}/sep6`,
      transferServerSep24: undefined,
      kycServer: `${mock.url}/sep12`,
      quoteServer: `${mock.url}/sep38`,
      organization: { name: "Mock TRY anchor", description: "A test anchor. No real money moves." },
    });
    expect(anchor.currencies).toEqual([{ code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", anchorAsset: "TRY", status: "test", description: "USDC ramped against TRY" }]);
    expect(mock.requests[0]).toMatchObject({ method: "GET", path: "/.well-known/stellar.toml" });
  });

  it("refuses an anchor on another network, and a toml without SEP-10", async () => {
    await expect(discoverAnchor(mock.url, { expectedNetwork: Networks.PUBLIC })).rejects.toThrow(/not "Public Global/);
    const bare = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("stellar.toml")) return new Response('VERSION="2.7.0"\nSIGNING_KEY="' + mock.serverKey.publicKey() + '"\n');
      return fetch(input, init);
    };
    await expect(discoverAnchor(mock.url, { fetch: bare as typeof fetch })).rejects.toThrow(/no WEB_AUTH_ENDPOINT/);
    await expect(discoverAnchor("http://127.0.0.1:1")).rejects.toThrow();
  });
});

describe("SEP-10", () => {
  it("checks the challenge, signs it with the wallet and gets a token", async () => {
    const anchor = await discoverAnchor(mock.url);
    const session = await authenticateWithAnchor(anchor, signer);
    expect(session.account).toBe(wallet.publicKey());
    expect(session.token).toBe(`token-for-${mock.homeDomain}`);
    const [challenge, answer] = mock.requests.filter((r) => r.path === "/auth");
    expect(challenge).toMatchObject({ method: "GET" });
    expect(challenge!.query.get("account")).toBe(wallet.publicKey());
    expect(challenge!.query.get("home_domain")).toBe(mock.homeDomain);
    expect(answer).toMatchObject({ method: "POST" });
  });

  it("refuses a challenge that is not the anchor's, for another account, or on another network", async () => {
    const anchor = await discoverAnchor(mock.url);
    const forge = (transaction: string, network_passphrase = Networks.TESTNET) => async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/auth") && (init?.method ?? "GET") === "GET" ? new Response(JSON.stringify({ transaction, network_passphrase }), { headers: { "content-type": "application/json" } }) : fetch(input, init);

    const stranger = Keypair.random();
    const wrongSigner = WebAuth.buildChallengeTx(stranger, wallet.publicKey(), mock.homeDomain, 300, Networks.TESTNET, mock.homeDomain);
    await expect(authenticateWithAnchor(anchor, signer, { fetch: forge(wrongSigner) as typeof fetch })).rejects.toThrow(/refused/);

    const otherAccount = WebAuth.buildChallengeTx(mock.serverKey, stranger.publicKey(), mock.homeDomain, 300, Networks.TESTNET, mock.homeDomain);
    await expect(authenticateWithAnchor(anchor, signer, { fetch: forge(otherAccount) as typeof fetch })).rejects.toThrow(/is for G/);

    const otherDomain = WebAuth.buildChallengeTx(mock.serverKey, wallet.publicKey(), "evil.example", 300, Networks.TESTNET, mock.homeDomain);
    await expect(authenticateWithAnchor(anchor, signer, { fetch: forge(otherDomain) as typeof fetch })).rejects.toThrow(/refused/);

    const good = WebAuth.buildChallengeTx(mock.serverKey, wallet.publicKey(), mock.homeDomain, 300, Networks.TESTNET, mock.homeDomain);
    await expect(authenticateWithAnchor(anchor, signer, { fetch: forge(good, Networks.PUBLIC) as typeof fetch })).rejects.toThrow(/the anchor's toml says/);

    // A signer bound to another network refuses to sign the challenge at all.
    await expect(authenticateWithAnchor(anchor, keypairSigner(wallet, Networks.PUBLIC))).rejects.toThrow();
  });

  it("is refused by the anchor when the wallet's signature is missing", async () => {
    const anchor = await discoverAnchor(mock.url);
    const unsigned = { ...signer, signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }) };
    const error = await authenticateWithAnchor(anchor, unsigned).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnchorError);
    expect((error as AnchorError).step).toBe("SEP-10 token");
    expect((error as AnchorError).message).toMatch(/challenge refused/);
  });
});

describe("SEP-6", () => {
  it("reads the anchor's info", async () => {
    const { client } = await signIn();
    const info = await client.info();
    expect(info.deposit["USDC"]).toEqual({ enabled: true, authenticationRequired: true, feeFixed: undefined, feePercent: 0.5, minAmount: undefined, maxAmount: undefined, fundingMethods: ["bank_account"] });
    expect(info.withdraw["USDC"]).toMatchObject({ feeFixed: 1, minAmount: 10 });
  });

  it("asks for a deposit with the token, and follows it to completion", async () => {
    const { client } = await signIn();
    const deposit = await client.deposit({ assetCode: "USDC", amount: "100", type: "bank_account" });
    expect(deposit.id).toBe("dep-1");
    expect(deposit.how).toMatch(/IBAN/);
    expect(deposit.eta).toBe(60);
    expect(deposit.extraInfo).toEqual({ message: "testnet sandbox" });
    const request = mock.requests.find((r) => r.path === "/sep6/deposit")!;
    expect(request.auth).toBe(`Bearer token-for-${mock.homeDomain}`);
    expect(Object.fromEntries(request.query)).toEqual({ asset_code: "USDC", account: wallet.publicKey(), amount: "100", type: "bank_account" });

    const seen: string[] = [];
    const done = await client.follow("dep-1", { intervalMs: 1, onStatus: (t) => seen.push(t.status) });
    expect(seen).toEqual(["incomplete", "pending_user_transfer_start", "pending_anchor", "pending_stellar", "completed"]);
    expect(done).toMatchObject({ id: "dep-1", kind: "deposit", status: "completed", amountIn: "100", amountOut: "99.5", amountFee: "0.5", stellarTransactionId: "a".repeat(64) });
    expect((await client.transactions("USDC")).map((t) => t.id)).toEqual(["dep-1"]);
  });

  it("surfaces the anchor's request for customer fields as AnchorNeedsMoreError", async () => {
    const { client } = await signIn();
    mock.needs = ["first_name", "last_name", "bank_account_number"];
    const error = await client.deposit({ assetCode: "USDC", type: "bank_account" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnchorNeedsMoreError);
    expect((error as AnchorNeedsMoreError).type).toBe("non_interactive_customer_info_needed");
    expect((error as AnchorNeedsMoreError).fields).toEqual(["first_name", "last_name", "bank_account_number"]);
  });

  it("asks for a withdrawal and answers where to send the asset", async () => {
    const { client } = await signIn();
    const withdrawal = await client.withdraw({ assetCode: "USDC", type: "bank_account", amount: "50", dest: "TR00 0000" });
    expect(withdrawal).toMatchObject({ id: "wd-1", accountId: mock.serverKey.publicKey(), memo: "wd-1", memoType: "text", eta: 120, feeFixed: 1 });
    const request = mock.requests.find((r) => r.path === "/sep6/withdraw")!;
    expect(Object.fromEntries(request.query)).toEqual({ asset_code: "USDC", type: "bank_account", account: wallet.publicKey(), amount: "50", dest: "TR00 0000" });
  });

  it("names a refusal, an unknown transaction and a missing transfer server", async () => {
    const { anchor, client } = await signIn();
    await expect(client.deposit({ assetCode: "EUR" })).rejects.toThrow(/SEP-6 deposit: unknown asset/);
    await expect(client.transaction("nope")).rejects.toThrow(/not found/);
    await expect(client.follow("dep-x", { timeoutMs: 1, intervalMs: 1 })).rejects.toThrow(/not found/);
    const session = await authenticateWithAnchor({ ...anchor, transferServer: undefined }, signer);
    expect(() => new Sep6Client(session)).toThrow(/no TRANSFER_SERVER/);
  });
});

describe("SEP-38", () => {
  it("quotes TRY into USDC", async () => {
    const { client } = await signIn();
    const price = await quotePrice(client.session, { sellAsset: sep38Asset.fiat("TRY"), buyAsset: sep38Asset.stellar("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"), sellAmount: "415" });
    expect(price).toMatchObject({ price: "41.5", sellAmount: "415", buyAmount: "10.00", totalPrice: "41.7" });
    const request = mock.requests.find((r) => r.path === "/sep38/price")!;
    expect(request.query.get("sell_asset")).toBe("iso4217:TRY");
    expect(request.query.get("buy_asset")).toBe("stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    await expect(quotePrice(client.session, { sellAsset: "iso4217:TRY", buyAsset: "x" })).rejects.toThrow(/one of the two/);
  });
});

describe("the signed challenge", () => {
  it("carries both signatures, the anchor's and the wallet's", async () => {
    const anchor = await discoverAnchor(mock.url);
    let posted = "";
    const spy = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") posted = (JSON.parse(String(init.body)) as { transaction: string }).transaction;
      return fetch(input, init);
    };
    await authenticateWithAnchor(anchor, signer, { fetch: spy as typeof fetch });
    const tx = new Transaction(posted, Networks.TESTNET);
    expect(tx.signatures).toHaveLength(2);
    expect(WebAuth.verifyTxSignedBy(tx, mock.serverKey.publicKey())).toBe(true);
    expect(WebAuth.verifyTxSignedBy(tx, wallet.publicKey())).toBe(true);
  });
});
