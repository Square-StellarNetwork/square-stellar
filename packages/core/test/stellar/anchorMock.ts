import { createServer, type Server as HttpServer } from "node:http";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";

/**
 * An anchor in a test: SEP-1 toml, SEP-10 challenge and token, SEP-6 info,
 * deposit, withdraw, transaction(s), SEP-38 price. It records every request,
 * builds real SEP-10 challenges with its own signing key and verifies the
 * client's signature the way an anchor does, and moves a deposit through
 * the statuses one read at a time.
 */
export interface MockAnchor {
  url: string;
  homeDomain: string;
  serverKey: Keypair;
  requests: Array<{ method: string; path: string; query: URLSearchParams; auth: string | undefined }>;
  /** SEP-12 fields the next deposit asks for; empty means none. */
  needs: string[];
  close(): Promise<void>;
}

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const STATUSES = ["incomplete", "pending_user_transfer_start", "pending_anchor", "pending_stellar", "completed"];

export async function startMockAnchor(): Promise<MockAnchor> {
  const serverKey = Keypair.random();
  const requests: MockAnchor["requests"] = [];
  const transactions = new Map<string, { kind: string; reads: number; amount: string | undefined }>();
  let counter = 0;
  const mock: MockAnchor = { url: "", homeDomain: "", serverKey, requests, needs: [], close: async () => {} };

  const server: HttpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const auth = req.headers.authorization;
    requests.push({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, auth });
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    const authed = (): boolean => {
      if (auth !== `Bearer token-for-${mock.homeDomain}`) {
        json(401, { error: "no token" });
        return false;
      }
      return true;
    };
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (url.pathname === "/.well-known/stellar.toml") {
        res.setHeader("content-type", "text/plain");
        res.end(
          [
            'VERSION="2.7.0"',
            `NETWORK_PASSPHRASE="${Networks.TESTNET}"`,
            `SIGNING_KEY="${serverKey.publicKey()}"`,
            `WEB_AUTH_ENDPOINT="${mock.url}/auth"`,
            `TRANSFER_SERVER="${mock.url}/sep6"`,
            `KYC_SERVER="${mock.url}/sep12"`,
            `ANCHOR_QUOTE_SERVER="${mock.url}/sep38"`,
            "[DOCUMENTATION]",
            'ORG_NAME="Mock TRY anchor"',
            'ORG_DESCRIPTION="A test anchor. No real money moves."',
            "[[CURRENCIES]]",
            'code="USDC"',
            `issuer="${USDC_ISSUER}"`,
            'status="test"',
            'anchor_asset="TRY"',
            'desc="USDC ramped against TRY"',
          ].join("\n"),
        );
        return;
      }
      if (url.pathname === "/auth" && req.method === "GET") {
        const account = url.searchParams.get("account");
        if (!account) return json(400, { error: "account is required" });
        const transaction = WebAuth.buildChallengeTx(serverKey, account, mock.homeDomain, 300, Networks.TESTNET, mock.homeDomain);
        return json(200, { transaction, network_passphrase: Networks.TESTNET });
      }
      if (url.pathname === "/auth" && req.method === "POST") {
        const { transaction } = JSON.parse(body) as { transaction: string };
        try {
          const read = WebAuth.readChallengeTx(transaction, serverKey.publicKey(), Networks.TESTNET, mock.homeDomain, mock.homeDomain);
          WebAuth.verifyChallengeTxSigners(transaction, serverKey.publicKey(), Networks.TESTNET, [read.clientAccountID], mock.homeDomain, mock.homeDomain);
        } catch (error) {
          return json(400, { error: `challenge refused: ${error instanceof Error ? error.message : String(error)}` });
        }
        const claims = Buffer.from(JSON.stringify({ sub: "x", exp: 1_800_000_000 })).toString("base64url");
        return json(200, { token: `token-for-${mock.homeDomain}` });
        void claims;
      }
      if (url.pathname === "/sep6/info") {
        return json(200, {
          deposit: { USDC: { enabled: true, authentication_required: true, fee_percent: 0.5, funding_methods: ["bank_account"], fields: { type: { choices: ["bank_account"], optional: false } } } },
          withdraw: { USDC: { enabled: true, authentication_required: true, fee_fixed: 1, min_amount: 10, funding_methods: ["bank_account"], types: { bank_account: { fields: {} } } } },
        });
      }
      if (url.pathname === "/sep6/deposit") {
        if (!authed()) return;
        if (mock.needs.length > 0) return json(403, { type: "non_interactive_customer_info_needed", fields: mock.needs });
        if (url.searchParams.get("asset_code") !== "USDC") return json(400, { error: "unknown asset" });
        const id = `dep-${++counter}`;
        transactions.set(id, { kind: "deposit", reads: 0, amount: url.searchParams.get("amount") ?? undefined });
        return json(200, { id, how: "Send TRY to IBAN TR00 0000 0000 with reference " + id, eta: 60, fee_percent: 0.5, extra_info: { message: "testnet sandbox" } });
      }
      if (url.pathname === "/sep6/withdraw") {
        if (!authed()) return;
        const id = `wd-${++counter}`;
        transactions.set(id, { kind: "withdrawal", reads: 0, amount: url.searchParams.get("amount") ?? undefined });
        return json(200, { id, account_id: serverKey.publicKey(), memo_type: "text", memo: id, eta: 120, fee_fixed: 1 });
      }
      if (url.pathname === "/sep6/transaction") {
        if (!authed()) return;
        const id = url.searchParams.get("id") ?? "";
        const entry = transactions.get(id);
        if (!entry) return json(404, { error: "not found" });
        const status = STATUSES[Math.min(entry.reads, STATUSES.length - 1)]!;
        entry.reads += 1;
        return json(200, {
          transaction: {
            id,
            kind: entry.kind,
            status,
            amount_in: entry.amount ?? "100",
            amount_out: status === "completed" ? "99.5" : undefined,
            amount_fee: "0.5",
            stellar_transaction_id: status === "completed" ? "a".repeat(64) : undefined,
            started_at: "2026-09-20T00:00:00Z",
          },
        });
      }
      if (url.pathname === "/sep6/transactions") {
        if (!authed()) return;
        return json(200, { transactions: [...transactions.entries()].map(([id, entry]) => ({ id, kind: entry.kind, status: "completed" })) });
      }
      if (url.pathname === "/sep38/price") {
        if (!authed()) return;
        const sell = url.searchParams.get("sell_amount");
        if (!sell) return json(400, { error: "sell_amount is required here" });
        const price = "41.5";
        return json(200, { price, sell_amount: sell, buy_amount: (Number(sell) / Number(price)).toFixed(2), total_price: "41.7", fee: { total: "0.5", asset: "iso4217:TRY" } });
      }
      json(404, { error: `no route ${url.pathname}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the mock did not bind a port");
  mock.homeDomain = `127.0.0.1:${address.port}`;
  mock.url = `http://${mock.homeDomain}`;
  mock.close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return mock;
}
