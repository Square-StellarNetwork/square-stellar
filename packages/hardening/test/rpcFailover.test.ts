import type { Server } from "@stellar/stellar-sdk/rpc";
import { describe, expect, it, vi } from "vitest";
import {
  NoUsableEndpointError,
  createFailoverRpc,
  isEndpointFailure,
  isPermanentRpcError,
  jitteredBackoffDelay,
  withRpcRetry,
} from "../src/rpcFailover.js";

/**
 * Doubles for `rpc.Server`: each endpoint is a bag of methods the test
 * scripts. `getNetwork` answers testnet unless told otherwise, so the
 * passphrase check passes without a line in every test.
 */
const TESTNET = "Test SDF Network ; September 2015";
const PUBNET = "Public Global Stellar Network ; September 2015";
const PRIMARY = "https://primary.test";
const SECONDARY = "https://secondary.test";
const TERTIARY = "https://tertiary.test";

type Methods = Record<string, (...args: unknown[]) => Promise<unknown>>;

function double(methods: Methods, passphrase = TESTNET): Server {
  const unscripted = async () => Promise.reject(new Error("not scripted"));
  return {
    getNetwork: async () => ({ passphrase, protocolVersion: "28" }),
    getHealth: unscripted,
    getLatestLedger: unscripted,
    getLedgerEntry: unscripted,
    simulateTransaction: unscripted,
    serverURL: new URL("https://double.test"),
    ...methods,
  } as unknown as Server;
}

function factory(servers: Record<string, Server>): (url: string) => Server {
  return (url) => {
    const server = servers[url];
    if (server === undefined) throw new Error(`no double for ${url}`);
    return server;
  };
}

const transportDown = (what: string) => new TypeError(`fetch failed: ${what}`);
const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
const jsonRpc = (code: number, message: string) => ({ code, message });

describe("createFailoverRpc", () => {
  it("fails over, reports the broken endpoint in cooldown, skips it while cooling, and retries it afterwards", async () => {
    let clock = 100_000;
    const primaryHealth = vi.fn(async (): Promise<{ status: string; latestLedger: number }> => {
      throw transportDown("primary down");
    });
    const secondaryHealth = vi.fn(async () => ({ status: "healthy", latestLedger: 10 }));
    const onFailover = vi.fn<(from: string, to: string, error: Error) => void>();
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getHealth: primaryHealth }), [SECONDARY]: double({ getHealth: secondaryHealth }) }),
      onFailover,
      baseCooldownMs: 5_000,
      maxBackoffMs: 60_000,
      now: () => clock,
    });

    expect((await rpc.getHealth()).latestLedger).toBe(10);
    expect(primaryHealth).toHaveBeenCalledTimes(1);
    expect(secondaryHealth).toHaveBeenCalledTimes(1);
    expect(onFailover).toHaveBeenCalledTimes(1);
    expect(onFailover.mock.calls[0]?.[0]).toBe(PRIMARY);
    expect(onFailover.mock.calls[0]?.[1]).toBe(SECONDARY);
    expect(onFailover.mock.calls[0]?.[2].message).toContain("primary down");

    const [primary, secondary] = rpc.endpointHealth();
    expect(primary).toMatchObject({ url: PRIMARY, healthy: false, consecutiveFailures: 1, cooldownUntil: clock + 5_000, wrongNetwork: undefined });
    expect(primary?.lastError).toContain("primary down");
    expect(secondary).toMatchObject({ url: SECONDARY, healthy: true, consecutiveFailures: 0, lastSuccessAt: clock });

    expect((await rpc.getHealth()).latestLedger).toBe(10);
    expect(primaryHealth).toHaveBeenCalledTimes(1);
    expect(secondaryHealth).toHaveBeenCalledTimes(2);
    expect(onFailover).toHaveBeenCalledTimes(1);

    clock += 5_001;
    primaryHealth.mockImplementation(async () => ({ status: "healthy", latestLedger: 20 }));
    expect((await rpc.getHealth()).latestLedger).toBe(20);
    expect(primaryHealth).toHaveBeenCalledTimes(2);
    expect(secondaryHealth).toHaveBeenCalledTimes(2);
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: true, consecutiveFailures: 0, cooldownUntil: undefined });
  });

  it("still tries a cooling endpoint when nothing healthier follows it", async () => {
    let clock = 0;
    let primaryDown = true;
    const primary = vi.fn(async () => {
      if (primaryDown) throw transportDown("primary");
      return 1;
    });
    const secondary = vi.fn(async () => {
      throw httpError(502);
    });
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getLatestLedger: primary }), [SECONDARY]: double({ getLatestLedger: secondary }) }),
      baseCooldownMs: 10_000,
      now: () => clock,
    });
    await expect(rpc.getLatestLedger()).rejects.toThrow("status code 502");
    expect(rpc.endpointHealth().every((endpoint) => !endpoint.healthy)).toBe(true);
    clock = 1;
    primaryDown = false;
    expect(await rpc.getLatestLedger()).toBe(1);
    expect(primary).toHaveBeenCalledTimes(2);
    expect(secondary).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially and caps the cooldown at maxBackoffMs", async () => {
    let clock = 0;
    const rpc = createFailoverRpc([PRIMARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getLatestLedger: async () => Promise.reject(transportDown("x")) }) }),
      baseCooldownMs: 1_000,
      maxBackoffMs: 3_000,
      now: () => clock,
    });
    const cooldowns: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(rpc.getLatestLedger()).rejects.toThrow();
      cooldowns.push((rpc.endpointHealth()[0]?.cooldownUntil ?? 0) - clock);
      clock += 10_000;
    }
    expect(cooldowns).toEqual([1_000, 2_000, 3_000, 3_000]);
  });

  it("waits for failureThreshold consecutive failures before cooling down", async () => {
    let clock = 0;
    const rpc = createFailoverRpc([PRIMARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getLatestLedger: async () => Promise.reject(transportDown("x")) }) }),
      failureThreshold: 3,
      baseCooldownMs: 1_000,
      now: () => clock,
    });
    await expect(rpc.getLatestLedger()).rejects.toThrow();
    await expect(rpc.getLatestLedger()).rejects.toThrow();
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: true, consecutiveFailures: 2 });
    await expect(rpc.getLatestLedger()).rejects.toThrow();
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: false, consecutiveFailures: 3, cooldownUntil: 1_000 });
  });

  it("leaves an endpoint healthy when the node answered, throws the answer as is, and reports no failover", async () => {
    const notFound = new Error("failed to find an entry for key AAAA");
    const badParams = jsonRpc(-32602, "startLedger must be within the ledger range");
    const primary = vi.fn(async (what: unknown) => {
      throw what === "entry" ? notFound : badParams;
    });
    const secondary = vi.fn(async () => "never");
    const onFailover = vi.fn();
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getLedgerEntry: primary }), [SECONDARY]: double({ getLedgerEntry: secondary }) }),
      onFailover,
    });
    await expect(rpc.getLedgerEntry("entry" as never)).rejects.toBe(notFound);
    await expect(rpc.getLedgerEntry("params" as never)).rejects.toBe(badParams);
    expect(secondary).not.toHaveBeenCalled();
    expect(onFailover).not.toHaveBeenCalled();
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: true, consecutiveFailures: 0, lastError: undefined });
  });

  it("moves on for a JSON-RPC internal error, which is the endpoint's", async () => {
    const primary = double({ getLatestLedger: async () => Promise.reject(jsonRpc(-32603, "internal error")) });
    const secondary = double({ getLatestLedger: async () => 5 });
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], { networkPassphrase: TESTNET, serverFactory: factory({ [PRIMARY]: primary, [SECONDARY]: secondary }) });
    expect(await rpc.getLatestLedger()).toBe(5);
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: false, consecutiveFailures: 1, lastError: "internal error" });
  });

  it("throws the last endpoint's error once every endpoint failed", async () => {
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({
        [PRIMARY]: double({ getLatestLedger: async () => Promise.reject(transportDown("one")) }),
        [SECONDARY]: double({ getLatestLedger: async () => Promise.reject(transportDown("two")) }),
      }),
    });
    await expect(rpc.getLatestLedger()).rejects.toThrow("two");
  });

  it("excludes an endpoint on another network for good and serves from the next", async () => {
    const primaryCalls = vi.fn(async () => 1);
    const primary = double({ getLatestLedger: primaryCalls }, PUBNET);
    const secondary = double({ getLatestLedger: async () => 2 });
    const onFailover = vi.fn();
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], { networkPassphrase: TESTNET, serverFactory: factory({ [PRIMARY]: primary, [SECONDARY]: secondary }), onFailover });
    expect(await rpc.getLatestLedger()).toBe(2);
    expect(await rpc.getLatestLedger()).toBe(2);
    expect(primaryCalls).not.toHaveBeenCalled();
    expect(onFailover).not.toHaveBeenCalled();
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: false, wrongNetwork: PUBNET });
    expect(rpc.endpointHealth()[0]?.lastError).toContain(PUBNET);
  });

  it("refuses to serve when no endpoint is on the expected network", async () => {
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({}, PUBNET), [SECONDARY]: double({}, "Standalone Network ; February 2017") }),
    });
    const error = await rpc.getLatestLedger().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoUsableEndpointError);
    expect((error as NoUsableEndpointError).health.map((endpoint) => endpoint.wrongNetwork)).toEqual([PUBNET, "Standalone Network ; February 2017"]);
  });

  it("asks each endpoint its network once, before its first request, and counts a failure there like any other", async () => {
    let clock = 0;
    let primaryUp = false;
    const primaryNetwork = vi.fn(async () => {
      if (!primaryUp) throw transportDown("network");
      return { passphrase: TESTNET, protocolVersion: "28" };
    });
    const secondaryNetwork = vi.fn(async () => ({ passphrase: TESTNET, protocolVersion: "28" }));
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({
        [PRIMARY]: double({ getNetwork: primaryNetwork, getLatestLedger: async () => 1 }),
        [SECONDARY]: double({ getNetwork: secondaryNetwork, getLatestLedger: async () => 2 }),
      }),
      baseCooldownMs: 1_000,
      now: () => clock,
    });
    expect(await rpc.getLatestLedger()).toBe(2);
    expect(rpc.endpointHealth()[0]).toMatchObject({ healthy: false, consecutiveFailures: 1 });
    expect(await rpc.getLatestLedger()).toBe(2);
    expect(secondaryNetwork).toHaveBeenCalledTimes(1);
    clock = 2_000;
    primaryUp = true;
    expect(await rpc.getLatestLedger()).toBe(1);
    expect(await rpc.getLatestLedger()).toBe(1);
    expect(primaryNetwork).toHaveBeenCalledTimes(2);
  });

  it("serves getNetwork itself through the same check", async () => {
    const rpc = createFailoverRpc([PRIMARY], { networkPassphrase: TESTNET, serverFactory: factory({ [PRIMARY]: double({}) }) });
    expect((await rpc.getNetwork()).passphrase).toBe(TESTNET);
  });

  it("lets the caller replace the rule that decides which errors are the endpoint's fault", async () => {
    const answered = new Error("answered");
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], {
      networkPassphrase: TESTNET,
      serverFactory: factory({ [PRIMARY]: double({ getLatestLedger: async () => Promise.reject(answered) }), [SECONDARY]: double({ getLatestLedger: async () => 2 }) }),
      isEndpointFailure: (error) => error === answered,
    });
    expect(await rpc.getLatestLedger()).toBe(2);
  });

  it("is a Server for whatever takes one, with the primary's properties and the endpoint list", () => {
    const rpc = createFailoverRpc([PRIMARY, SECONDARY], { networkPassphrase: TESTNET, serverFactory: factory({ [PRIMARY]: double({}), [SECONDARY]: double({}) }) });
    expect(rpc.serverURL.toString()).toBe("https://double.test/");
    expect(rpc.endpoints).toEqual([PRIMARY, SECONDARY]);
    expect(typeof rpc.simulateTransaction).toBe("function");
  });

  it("builds real servers by default, refusing http without allowHttp as rpc.Server does", () => {
    expect(() => createFailoverRpc(["http://127.0.0.1:8000/rpc"], { networkPassphrase: TESTNET })).toThrow(/allowHttp/);
    expect(createFailoverRpc(["http://127.0.0.1:8000/rpc"], { networkPassphrase: TESTNET, allowHttp: true }).serverURL.toString()).toBe("http://127.0.0.1:8000/rpc");
  });

  it("rejects an empty url list", () => {
    expect(() => createFailoverRpc([], { networkPassphrase: TESTNET })).toThrow(TypeError);
  });
});

describe("withRpcRetry", () => {
  it("retries with jittered exponential backoff until the call succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRpcRetry(
      async (attempt) => {
        calls += 1;
        if (attempt < 3) throw new Error("flaky");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, random: () => 0.5, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([75, 150]);
  });

  it("gives up after the configured number of attempts", async () => {
    let calls = 0;
    await expect(
      withRpcRetry(
        async () => {
          calls += 1;
          throw new Error("flaky");
        },
        { attempts: 2, sleep: async () => undefined },
      ),
    ).rejects.toThrow("flaky");
    expect(calls).toBe(2);
  });

  it("does not retry errors the predicate marks permanent", async () => {
    let calls = 0;
    await expect(
      withRpcRetry(
        async () => {
          calls += 1;
          throw new Error("permanent");
        },
        { attempts: 5, isRetryable: () => false, sleep: async () => undefined },
      ),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
  });

  it("caps the delay at maxDelayMs and keeps half of the ceiling as a floor", () => {
    expect(jitteredBackoffDelay(10, 100, 1_000, () => 1)).toBe(1_000);
    expect(jitteredBackoffDelay(10, 100, 1_000, () => 0)).toBe(500);
    expect(jitteredBackoffDelay(1, 200, 5_000, () => 0)).toBe(100);
  });

  it("never calls fn when the signal was already aborted before the first attempt", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRpcRetry(
        async () => {
          calls += 1;
          throw new Error("rpc down");
        },
        { attempts: 3, signal: controller.signal, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/abort/i);
    expect(calls).toBe(0);
  });

  it("cuts the backoff sleep short when the signal aborts, and does not call fn again", async () => {
    let calls = 0;
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 20);
    await expect(
      withRpcRetry(
        async () => {
          calls += 1;
          throw new Error("rpc down");
        },
        { attempts: 3, baseDelayMs: 400, maxDelayMs: 400, random: () => 1, signal: controller.signal },
      ),
    ).rejects.toThrow("rpc down");
    expect(calls).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(390);
  });

  it("sleeps the full backoff when no signal aborts it", async () => {
    let calls = 0;
    const controller = new AbortController();
    const startedAt = Date.now();
    await expect(
      withRpcRetry(
        async () => {
          calls += 1;
          throw new Error("rpc down");
        },
        { attempts: 2, baseDelayMs: 60, maxDelayMs: 60, random: () => 1, signal: controller.signal },
      ),
    ).rejects.toThrow("rpc down");
    expect(calls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it("does not retry a permanent json-rpc error under the default predicate, and still retries a server error", async () => {
    for (const code of [-32600, -32601, -32602, -32603]) {
      let calls = 0;
      await expect(
        withRpcRetry(
          async () => {
            calls += 1;
            throw jsonRpc(code, "invalid params");
          },
          { attempts: 4, sleep: async () => undefined },
        ),
      ).rejects.toMatchObject({ code });
      expect(calls).toBe(1);
    }
    let transient = 0;
    await expect(
      withRpcRetry(
        async () => {
          transient += 1;
          throw jsonRpc(-32000, "server error");
        },
        { attempts: 4, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: -32000 });
    expect(transient).toBe(4);
  });
});

describe("isPermanentRpcError", () => {
  it("finds the code through a wrapped cause chain and leaves transient errors retryable", () => {
    expect(isPermanentRpcError(jsonRpc(-32602, "invalid params"))).toBe(true);
    expect(isPermanentRpcError(new Error("outer", { cause: jsonRpc(-32601, "method not found") }))).toBe(true);
    expect(isPermanentRpcError(jsonRpc(-32005, "limit exceeded"))).toBe(false);
    expect(isPermanentRpcError(new Error("socket hang up"))).toBe(false);
    expect(isPermanentRpcError("not an object")).toBe(false);
  });

  it("survives a self-referencing cause chain", () => {
    const looping = new Error("looping") as Error & { cause?: unknown };
    looping.cause = looping;
    expect(isPermanentRpcError(looping)).toBe(false);
  });
});

describe("isEndpointFailure", () => {
  it("counts a failure to answer and spares every answer the node gave", () => {
    expect(isEndpointFailure(transportDown("ECONNREFUSED"))).toBe(true);
    expect(isEndpointFailure(new Error("timeout of 10000ms exceeded"))).toBe(true);
    expect(isEndpointFailure(new Error("socket hang up"))).toBe(true);
    expect(isEndpointFailure(Object.assign(new Error("Timeout"), { name: "TimeoutError" }))).toBe(true);
    expect(isEndpointFailure(httpError(502))).toBe(true);
    expect(isEndpointFailure(httpError(429))).toBe(true);
    expect(isEndpointFailure(jsonRpc(-32603, "internal error"))).toBe(true);
    expect(isEndpointFailure(jsonRpc(-32000, "server error"))).toBe(true);
    expect(isEndpointFailure("not an object")).toBe(true);

    expect(isEndpointFailure(jsonRpc(-32602, "startLedger must be within the ledger range"))).toBe(false);
    expect(isEndpointFailure(jsonRpc(-32601, "method not found"))).toBe(false);
    expect(isEndpointFailure(jsonRpc(-32600, "invalid request"))).toBe(false);
    expect(isEndpointFailure(jsonRpc(-32700, "parse error"))).toBe(false);
    expect(isEndpointFailure(new Error("failed to find an entry for key AAAA"))).toBe(false);
    expect(isEndpointFailure(new Error("Trustline for USDC:GBBD… not found for GA…"))).toBe(false);
    expect(isEndpointFailure(new Error("Account not found: GA…"))).toBe(false);
  });

  it("reads the shape through a wrapped cause chain, the first link that decides winning", () => {
    expect(isEndpointFailure(new Error("HTTP request failed.", { cause: transportDown("x") }))).toBe(true);
    expect(isEndpointFailure(new Error("request failed", { cause: jsonRpc(-32602, "invalid params") }))).toBe(false);
    expect(isEndpointFailure(new Error("wrapped", { cause: httpError(503) }))).toBe(true);
  });

  it("survives a self-referencing cause chain", () => {
    const looping = new Error("looping") as Error & { cause?: unknown };
    looping.cause = looping;
    expect(isEndpointFailure(looping)).toBe(false);
  });

  it("answers a different question than isPermanentRpcError", () => {
    const internal = jsonRpc(-32603, "internal error");
    expect(isPermanentRpcError(internal)).toBe(true);
    expect(isEndpointFailure(internal)).toBe(true);
    const serverError = jsonRpc(-32000, "server error");
    expect(isPermanentRpcError(serverError)).toBe(false);
    expect(isEndpointFailure(serverError)).toBe(true);
  });
});
