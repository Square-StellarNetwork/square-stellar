import { Networks, WebAuth } from "@stellar/stellar-sdk";
import { parse as parseToml } from "smol-toml";
import { isAccountAddress } from "./address.js";
import type { Signer } from "./signer.js";

/**
 * The anchor side of the MVP (#58): a fiat rail into and out of a wallet,
 * through the SEPs an anchor serves. SEP-1 finds the anchor, SEP-10 signs in
 * with the wallet, SEP-6 asks for a deposit or a withdrawal and follows it,
 * SEP-38 quotes the rate. Nothing here touches the kernel: what the anchor
 * puts in the wallet (USDC on testnet) is then funded into a job the way any
 * balance is.
 *
 * The app drives this from a browser and a script from Node; both hand in a
 * `fetch` (the global one by default) and, for SEP-10, the wallet as a
 * `Signer`: the challenge is signed with the same `signTransaction` every
 * kernel write uses.
 */

export interface AnchorCurrency {
  code: string;
  issuer: string | undefined;
  /** The fiat it is anchored to (`TRY`), when the toml says. */
  anchorAsset: string | undefined;
  status: string | undefined;
  description: string | undefined;
}

export interface Anchor {
  homeDomain: string;
  /** Where SEP-10 signs in; the anchor's `WEB_AUTH_ENDPOINT`. */
  webAuthEndpoint: string;
  /** The account the anchor signs challenges with; `SIGNING_KEY`. */
  signingKey: string;
  networkPassphrase: string;
  /** SEP-6, when served. */
  transferServer: string | undefined;
  /** SEP-24, when served. */
  transferServerSep24: string | undefined;
  /** SEP-12, when served. */
  kycServer: string | undefined;
  /** SEP-38, when served. */
  quoteServer: string | undefined;
  currencies: AnchorCurrency[];
  organization: { name: string | undefined; description: string | undefined };
}

export class AnchorError extends Error {
  constructor(
    readonly anchor: string,
    readonly step: string,
    message: string,
    readonly status?: number | undefined,
    readonly body?: unknown,
  ) {
    super(`${anchor}: ${step}: ${message}`);
    this.name = "AnchorError";
  }
}

export interface AnchorOptions {
  fetch?: typeof fetch | undefined;
}

const fetchOf = (options: AnchorOptions | undefined): typeof fetch => options?.fetch ?? globalThis.fetch;

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * SEP-1: the anchor's `stellar.toml` at its home domain, read into what the
 * other SEPs need. Refuses a toml without a signing key or a web-auth
 * endpoint, and one for another network than `expectedNetwork` when given.
 */
export async function discoverAnchor(homeDomain: string, options: AnchorOptions & { expectedNetwork?: string | undefined } = {}): Promise<Anchor> {
  // A bare domain is reached over https, as SEP-1 says; an explicit http://
  // is kept, for a local anchor in a test.
  const scheme = homeDomain.startsWith("http://") ? "http" : "https";
  const domain = homeDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const url = `${scheme}://${domain}/.well-known/stellar.toml`;
  const response = await fetchOf(options)(url);
  if (!response.ok) throw new AnchorError(domain, "SEP-1", `${url} answered ${response.status}`, response.status);
  let toml: Record<string, unknown>;
  try {
    toml = parseToml(await response.text()) as Record<string, unknown>;
  } catch (error) {
    throw new AnchorError(domain, "SEP-1", `${url} is not TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const signingKey = stringField(toml, "SIGNING_KEY");
  const webAuthEndpoint = stringField(toml, "WEB_AUTH_ENDPOINT");
  if (signingKey === undefined || !isAccountAddress(signingKey)) throw new AnchorError(domain, "SEP-1", "stellar.toml has no SIGNING_KEY (G…)");
  if (webAuthEndpoint === undefined) throw new AnchorError(domain, "SEP-1", "stellar.toml has no WEB_AUTH_ENDPOINT: the anchor serves no SEP-10");
  const networkPassphrase = stringField(toml, "NETWORK_PASSPHRASE") ?? Networks.PUBLIC;
  if (options.expectedNetwork !== undefined && networkPassphrase !== options.expectedNetwork) {
    throw new AnchorError(domain, "SEP-1", `the anchor is on "${networkPassphrase}", not "${options.expectedNetwork}"`);
  }
  const documentation = (typeof toml["DOCUMENTATION"] === "object" && toml["DOCUMENTATION"] !== null ? toml["DOCUMENTATION"] : {}) as Record<string, unknown>;
  const currencies = (Array.isArray(toml["CURRENCIES"]) ? toml["CURRENCIES"] : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      code: stringField(entry, "code") ?? "",
      issuer: stringField(entry, "issuer"),
      anchorAsset: stringField(entry, "anchor_asset"),
      status: stringField(entry, "status"),
      description: stringField(entry, "desc"),
    }))
    .filter((currency) => currency.code !== "");
  return {
    homeDomain: domain,
    webAuthEndpoint,
    signingKey,
    networkPassphrase,
    transferServer: stringField(toml, "TRANSFER_SERVER"),
    transferServerSep24: stringField(toml, "TRANSFER_SERVER_SEP0024"),
    kycServer: stringField(toml, "KYC_SERVER"),
    quoteServer: stringField(toml, "ANCHOR_QUOTE_SERVER"),
    currencies,
    organization: { name: stringField(documentation, "ORG_NAME"), description: stringField(documentation, "ORG_DESCRIPTION") },
  };
}

export interface AnchorSession {
  anchor: Anchor;
  /** The wallet the session is for. */
  account: string;
  /** The JWT the anchor issued; sent as `Authorization: Bearer` to SEP-6/12/38. */
  token: string;
  /** Unix seconds the token expires at, when it says. */
  expiresAt: number | undefined;
}

/**
 * SEP-10: sign in to the anchor with the wallet. The challenge the anchor
 * returns is checked before it is signed, as the SEP requires of a client:
 * signed by the anchor's `SIGNING_KEY`, for this account, for this home
 * domain, on this network, sequence zero. Then the wallet signs it with
 * `signTransaction`, the same call that signs a kernel write, and the anchor
 * answers with a token.
 */
export async function authenticateWithAnchor(anchor: Anchor, signer: Signer, options: AnchorOptions & { clientDomain?: string | undefined } = {}): Promise<AnchorSession> {
  const doFetch = fetchOf(options);
  const account = signer.address;
  const query = new URLSearchParams({ account, home_domain: anchor.homeDomain });
  if (options.clientDomain !== undefined) query.set("client_domain", options.clientDomain);
  const challengeResponse = await doFetch(`${anchor.webAuthEndpoint}?${query.toString()}`);
  const challengeBody = (await challengeResponse.json().catch(() => undefined)) as { transaction?: unknown; network_passphrase?: unknown; error?: unknown } | undefined;
  if (!challengeResponse.ok || typeof challengeBody?.transaction !== "string") {
    throw new AnchorError(anchor.homeDomain, "SEP-10 challenge", describeError(challengeBody, challengeResponse.status), challengeResponse.status, challengeBody);
  }
  if (typeof challengeBody.network_passphrase === "string" && challengeBody.network_passphrase !== anchor.networkPassphrase) {
    throw new AnchorError(anchor.homeDomain, "SEP-10 challenge", `the challenge is for "${challengeBody.network_passphrase}", the anchor's toml says "${anchor.networkPassphrase}"`);
  }
  const webAuthDomain = new URL(anchor.webAuthEndpoint).host;
  let read: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    read = WebAuth.readChallengeTx(challengeBody.transaction, anchor.signingKey, anchor.networkPassphrase, anchor.homeDomain, webAuthDomain);
  } catch (error) {
    throw new AnchorError(anchor.homeDomain, "SEP-10 challenge", `refused: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (read.clientAccountID !== account) {
    throw new AnchorError(anchor.homeDomain, "SEP-10 challenge", `the challenge is for ${read.clientAccountID}, not ${account}`);
  }
  const signed = await signer.signTransaction(challengeBody.transaction, { networkPassphrase: anchor.networkPassphrase, address: account });
  if (signed.error) throw new AnchorError(anchor.homeDomain, "SEP-10 sign", signed.error.message ?? "the wallet refused to sign");
  const tokenResponse = await doFetch(anchor.webAuthEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: signed.signedTxXdr }),
  });
  const tokenBody = (await tokenResponse.json().catch(() => undefined)) as { token?: unknown; error?: unknown } | undefined;
  if (!tokenResponse.ok || typeof tokenBody?.token !== "string") {
    throw new AnchorError(anchor.homeDomain, "SEP-10 token", describeError(tokenBody, tokenResponse.status), tokenResponse.status, tokenBody);
  }
  return { anchor, account, token: tokenBody.token, expiresAt: jwtExpiry(tokenBody.token) };
}

function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

function describeError(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return `answered ${status}`;
}

// ---- SEP-6 ----------------------------------------------------------------------

/** What an anchor says it does for one asset, from `GET /info`. */
export interface Sep6AssetInfo {
  enabled: boolean;
  authenticationRequired: boolean;
  feeFixed: number | undefined;
  feePercent: number | undefined;
  minAmount: number | undefined;
  maxAmount: number | undefined;
  fundingMethods: string[];
}

export interface Sep6Info {
  deposit: Record<string, Sep6AssetInfo>;
  withdraw: Record<string, Sep6AssetInfo>;
}

/** A deposit or withdrawal as the anchor tracks it (`GET /transaction`). */
export interface Sep6Transaction {
  id: string;
  kind: string;
  /** SEP-6 statuses: `incomplete`, `pending_user_transfer_start`, `pending_anchor`, `pending_stellar`, `completed`, `refunded`, `error`, … */
  status: string;
  statusEta: number | undefined;
  amountIn: string | undefined;
  amountOut: string | undefined;
  amountFee: string | undefined;
  stellarTransactionId: string | undefined;
  externalTransactionId: string | undefined;
  message: string | undefined;
  /** A page the anchor offers for this transaction (`more_info_url`): where the user follows or, on a sandbox, simulates the fiat leg. */
  moreInfoUrl: string | undefined;
  startedAt: string | undefined;
  completedAt: string | undefined;
  raw: Record<string, unknown>;
}

/** The anchor's answer to a deposit request: how to send the fiat, and the transaction to follow. */
export interface Sep6DepositInstructions {
  id: string | undefined;
  /** Human instructions, when the anchor gives them (`how`). */
  how: string | undefined;
  /** Structured instructions (`instructions`), when the anchor gives them. */
  instructions: Record<string, unknown> | undefined;
  eta: number | undefined;
  minAmount: number | undefined;
  maxAmount: number | undefined;
  feeFixed: number | undefined;
  feePercent: number | undefined;
  extraInfo: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
}

/**
 * The anchor asked for more before it can serve: SEP-12 customer fields
 * (`non_interactive_customer_info_needed`), a review in progress
 * (`customer_info_status`), or an interactive step. `raw` is the anchor's
 * whole answer; `fields` the SEP-12 fields it named, when it did.
 */
export class AnchorNeedsMoreError extends AnchorError {
  constructor(
    anchor: string,
    step: string,
    readonly type: string,
    readonly fields: string[],
    readonly customerStatus: string | undefined,
    raw: unknown,
  ) {
    super(anchor, step, `${type}${fields.length ? `: ${fields.join(", ")}` : ""}${customerStatus ? ` (${customerStatus})` : ""}`, 403, raw);
    this.name = "AnchorNeedsMoreError";
  }
}

export interface Sep6DepositParams {
  assetCode: string;
  /** The wallet the asset lands in; the session's account when omitted. */
  account?: string | undefined;
  amount?: string | undefined;
  /** The funding method (`bank_account`); the anchor's `/info` lists them. */
  type?: string | undefined;
  /** Anything else the anchor's `/info` fields ask for. */
  extra?: Record<string, string> | undefined;
}

export interface Sep6WithdrawParams {
  assetCode: string;
  amount?: string | undefined;
  /** The withdrawal method (`bank_account`). */
  type: string;
  /** Where the fiat goes, as the anchor's `/info` describes for the type. */
  dest?: string | undefined;
  destExtra?: string | undefined;
  extra?: Record<string, string> | undefined;
}

export interface Sep6WithdrawInstructions {
  id: string | undefined;
  /** The Stellar account to send the asset to, and the memo to send it with. */
  accountId: string | undefined;
  memo: string | undefined;
  memoType: string | undefined;
  eta: number | undefined;
  minAmount: number | undefined;
  maxAmount: number | undefined;
  feeFixed: number | undefined;
  feePercent: number | undefined;
  extraInfo: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
}

const numberOr = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const stringOr = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const recordOr = (value: unknown): Record<string, unknown> | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

function assetInfo(entry: unknown): Sep6AssetInfo {
  const record = recordOr(entry) ?? {};
  return {
    enabled: record["enabled"] === true,
    authenticationRequired: record["authentication_required"] === true,
    feeFixed: numberOr(record["fee_fixed"]),
    feePercent: numberOr(record["fee_percent"]),
    minAmount: numberOr(record["min_amount"]),
    maxAmount: numberOr(record["max_amount"]),
    fundingMethods: Array.isArray(record["funding_methods"]) ? record["funding_methods"].filter((m): m is string => typeof m === "string") : [],
  };
}

function transactionOf(record: Record<string, unknown>): Sep6Transaction {
  return {
    id: stringOr(record["id"]) ?? "",
    kind: stringOr(record["kind"]) ?? "",
    status: stringOr(record["status"]) ?? "",
    statusEta: numberOr(record["status_eta"]),
    amountIn: stringOr(record["amount_in"]),
    amountOut: stringOr(record["amount_out"]),
    amountFee: stringOr(record["amount_fee"]),
    stellarTransactionId: stringOr(record["stellar_transaction_id"]),
    externalTransactionId: stringOr(record["external_transaction_id"]),
    message: stringOr(record["message"]),
    moreInfoUrl: stringOr(record["more_info_url"]),
    startedAt: stringOr(record["started_at"]),
    completedAt: stringOr(record["completed_at"]),
    raw: record,
  };
}

/** The SEP-6 statuses after which nothing more happens. */
export const SEP6_FINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "refunded", "expired", "error", "no_market", "too_small", "too_large"]);

/**
 * SEP-6 over a session: the anchor's transfer server, with the token. Every
 * call answers the anchor's JSON read into a type, throws `AnchorError` on a
 * refusal, and `AnchorNeedsMoreError` when the anchor wants SEP-12 fields or
 * is still reviewing the customer.
 */
export class Sep6Client {
  readonly transferServer: string;
  private readonly doFetch: typeof fetch;

  constructor(
    readonly session: AnchorSession,
    options: AnchorOptions = {},
  ) {
    const server = session.anchor.transferServer;
    if (server === undefined) throw new AnchorError(session.anchor.homeDomain, "SEP-6", "the anchor's toml names no TRANSFER_SERVER");
    this.transferServer = server.replace(/\/$/, "");
    this.doFetch = fetchOf(options);
  }

  private async get(path: string, query: Record<string, string>, step: string): Promise<Record<string, unknown>> {
    const url = `${this.transferServer}${path}?${new URLSearchParams(query).toString()}`;
    const response = await this.doFetch(url, { headers: { authorization: `Bearer ${this.session.token}` } });
    const body = (await response.json().catch(() => undefined)) as unknown;
    const record = recordOr(body);
    if (response.status === 403 && record) {
      const type = stringOr(record["type"]);
      if (type !== undefined) {
        const fields = Array.isArray(record["fields"]) ? record["fields"].filter((f): f is string => typeof f === "string") : [];
        throw new AnchorNeedsMoreError(this.session.anchor.homeDomain, step, type, fields, stringOr(record["status"]), record);
      }
    }
    if (!response.ok || !record) throw new AnchorError(this.session.anchor.homeDomain, step, describeError(body, response.status), response.status, body);
    return record;
  }

  /** `GET /info`: what the anchor deposits and withdraws, per asset. No token needed, sent anyway. */
  async info(): Promise<Sep6Info> {
    const record = await this.get("/info", {}, "SEP-6 info");
    const table = (key: string): Record<string, Sep6AssetInfo> =>
      Object.fromEntries(Object.entries(recordOr(record[key]) ?? {}).map(([code, entry]) => [code, assetInfo(entry)]));
    return { deposit: table("deposit"), withdraw: table("withdraw") };
  }

  /** `GET /deposit`: ask the anchor to take fiat and put `assetCode` in the wallet. */
  async deposit(params: Sep6DepositParams): Promise<Sep6DepositInstructions> {
    const query: Record<string, string> = { asset_code: params.assetCode, account: params.account ?? this.session.account, ...(params.extra ?? {}) };
    if (params.amount !== undefined) query["amount"] = params.amount;
    if (params.type !== undefined) query["type"] = params.type;
    const record = await this.get("/deposit", query, "SEP-6 deposit");
    return {
      id: stringOr(record["id"]),
      how: stringOr(record["how"]),
      instructions: recordOr(record["instructions"]),
      eta: numberOr(record["eta"]),
      minAmount: numberOr(record["min_amount"]),
      maxAmount: numberOr(record["max_amount"]),
      feeFixed: numberOr(record["fee_fixed"]),
      feePercent: numberOr(record["fee_percent"]),
      extraInfo: recordOr(record["extra_info"]),
      raw: record,
    };
  }

  /** `GET /withdraw`: ask the anchor to take `assetCode` from the wallet and pay fiat out. */
  async withdraw(params: Sep6WithdrawParams): Promise<Sep6WithdrawInstructions> {
    const query: Record<string, string> = { asset_code: params.assetCode, type: params.type, account: this.session.account, ...(params.extra ?? {}) };
    if (params.amount !== undefined) query["amount"] = params.amount;
    if (params.dest !== undefined) query["dest"] = params.dest;
    if (params.destExtra !== undefined) query["dest_extra"] = params.destExtra;
    const record = await this.get("/withdraw", query, "SEP-6 withdraw");
    return {
      id: stringOr(record["id"]),
      accountId: stringOr(record["account_id"]),
      memo: stringOr(record["memo"]),
      memoType: stringOr(record["memo_type"]),
      eta: numberOr(record["eta"]),
      minAmount: numberOr(record["min_amount"]),
      maxAmount: numberOr(record["max_amount"]),
      feeFixed: numberOr(record["fee_fixed"]),
      feePercent: numberOr(record["fee_percent"]),
      extraInfo: recordOr(record["extra_info"]),
      raw: record,
    };
  }

  /** `GET /transaction`: one deposit or withdrawal by the anchor's id. */
  async transaction(id: string): Promise<Sep6Transaction> {
    const record = await this.get("/transaction", { id }, "SEP-6 transaction");
    const inner = recordOr(record["transaction"]);
    if (!inner) throw new AnchorError(this.session.anchor.homeDomain, "SEP-6 transaction", "the answer carries no transaction", 200, record);
    return transactionOf(inner);
  }

  /** `GET /transactions`: this account's history for an asset, newest first as the anchor orders it. */
  async transactions(assetCode: string, query: { kind?: "deposit" | "withdrawal" | undefined; limit?: number | undefined } = {}): Promise<Sep6Transaction[]> {
    const params: Record<string, string> = { asset_code: assetCode, account: this.session.account };
    if (query.kind !== undefined) params["kind"] = query.kind;
    if (query.limit !== undefined) params["limit"] = String(query.limit);
    const record = await this.get("/transactions", params, "SEP-6 transactions");
    const list = Array.isArray(record["transactions"]) ? record["transactions"] : [];
    return list.map((entry) => transactionOf(recordOr(entry) ?? {}));
  }

  /**
   * Polls `GET /transaction` until the status is one `until` names (a final
   * one by default), or `timeoutMs` passes. `onStatus` sees each change.
   */
  async follow(
    id: string,
    options: { until?: ReadonlySet<string> | undefined; intervalMs?: number | undefined; timeoutMs?: number | undefined; onStatus?: ((transaction: Sep6Transaction) => void) | undefined } = {},
  ): Promise<Sep6Transaction> {
    const until = options.until ?? SEP6_FINAL_STATUSES;
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    let last: string | undefined;
    for (;;) {
      const transaction = await this.transaction(id);
      if (transaction.status !== last) {
        last = transaction.status;
        options.onStatus?.(transaction);
      }
      if (until.has(transaction.status)) return transaction;
      if (Date.now() >= deadline) throw new AnchorError(this.session.anchor.homeDomain, "SEP-6 transaction", `${id} is still ${transaction.status} after ${options.timeoutMs ?? 120_000} ms`);
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 3_000));
    }
  }
}

// ---- SEP-38 ---------------------------------------------------------------------

export interface Sep38Price {
  /** How much of `sellAsset` one unit of `buyAsset` costs. */
  price: string;
  sellAmount: string;
  buyAmount: string;
  totalPrice: string | undefined;
  fee: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
}

/** SEP-38 asset identifiers: `iso4217:TRY` for fiat, `stellar:USDC:G…` for an asset. */
export const sep38Asset = {
  fiat: (code: string): string => `iso4217:${code}`,
  stellar: (code: string, issuer: string): string => `stellar:${code}:${issuer}`,
};

/**
 * SEP-38 `GET /price`: an indicative rate for selling `sellAsset` for
 * `buyAsset`, one of `sellAmount` or `buyAmount` given. Needs the session
 * when the anchor requires it; sent with the token either way.
 */
export async function quotePrice(
  session: AnchorSession,
  params: { sellAsset: string; buyAsset: string; sellAmount?: string | undefined; buyAmount?: string | undefined; context?: "sep6" | "sep31" | undefined },
  options: AnchorOptions = {},
): Promise<Sep38Price> {
  const server = session.anchor.quoteServer;
  if (server === undefined) throw new AnchorError(session.anchor.homeDomain, "SEP-38", "the anchor's toml names no ANCHOR_QUOTE_SERVER");
  if ((params.sellAmount === undefined) === (params.buyAmount === undefined)) throw new AnchorError(session.anchor.homeDomain, "SEP-38", "give sellAmount or buyAmount, one of the two");
  const query: Record<string, string> = { sell_asset: params.sellAsset, buy_asset: params.buyAsset, context: params.context ?? "sep6" };
  if (params.sellAmount !== undefined) query["sell_amount"] = params.sellAmount;
  if (params.buyAmount !== undefined) query["buy_amount"] = params.buyAmount;
  const response = await fetchOf(options)(`${server.replace(/\/$/, "")}/price?${new URLSearchParams(query).toString()}`, { headers: { authorization: `Bearer ${session.token}` } });
  const body = (await response.json().catch(() => undefined)) as unknown;
  const record = recordOr(body);
  if (!response.ok || !record || typeof record["price"] !== "string") throw new AnchorError(session.anchor.homeDomain, "SEP-38 price", describeError(body, response.status), response.status, body);
  return {
    price: record["price"],
    sellAmount: stringOr(record["sell_amount"]) ?? params.sellAmount ?? "",
    buyAmount: stringOr(record["buy_amount"]) ?? params.buyAmount ?? "",
    totalPrice: stringOr(record["total_price"]),
    fee: recordOr(record["fee"]),
    raw: record,
  };
}
