import { createServer, type Server as HttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A JSON-RPC server that plays Stellar RPC for one test: each method answers
 * from a handler the test installs, and every request is kept so the test
 * can read what the client sent. The answers are real testnet responses
 * captured on 2026-09-19 (`fixtures/`), so the client is parsing what the
 * network actually says, on a port nothing else listens on.
 */
export interface RpcRequest {
  method: string;
  params: Record<string, unknown> | undefined;
}

export type RpcHandler = (params: Record<string, unknown> | undefined, request: RpcRequest) => unknown;

export interface MockRpc {
  url: string;
  requests: RpcRequest[];
  on(method: string, handler: RpcHandler): void;
  /** Answer `method` with a JSON-RPC error instead of a result. */
  fail(method: string, code: number, message: string): void;
  calls(method: string): RpcRequest[];
  close(): Promise<void>;
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

export async function startMockRpc(): Promise<MockRpc> {
  const handlers = new Map<string, RpcHandler>();
  const requests: RpcRequest[] = [];
  const server: HttpServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const parsed = JSON.parse(body) as { id: unknown; method: string; params?: Record<string, unknown> };
      const request: RpcRequest = { method: parsed.method, params: parsed.params };
      requests.push(request);
      const handler = handlers.get(parsed.method);
      res.setHeader("content-type", "application/json");
      if (!handler) {
        res.statusCode = 200;
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32601, message: `no handler for ${parsed.method}` } }));
        return;
      }
      let answer: unknown;
      try {
        answer = handler(parsed.params, request);
      } catch (error) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }));
        return;
      }
      if (answer instanceof RpcError) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: answer.code, message: answer.message } }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: answer }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the mock did not bind a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    on: (method, handler) => handlers.set(method, handler),
    fail: (method, code, message) => handlers.set(method, () => new RpcError(code, message)),
    calls: (method) => requests.filter((request) => request.method === method),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

class RpcError {
  constructor(
    readonly code: number,
    readonly message: string,
  ) {}
}
