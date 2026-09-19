import { Server } from "@stellar/stellar-sdk/rpc";

export interface EndpointHealth {
  url: string;
  healthy: boolean;
  /** Set once the endpoint answered `getNetwork` with a passphrase other than the one expected; it is never used again. */
  wrongNetwork: string | undefined;
  consecutiveFailures: number;
  cooldownUntil: number | undefined;
  lastError: string | undefined;
  lastFailureAt: number | undefined;
  lastSuccessAt: number | undefined;
}

export interface FailoverRpcOptions {
  /**
   * The passphrase every endpoint has to answer `getNetwork` with. An
   * endpoint on another network is excluded for good the first time it
   * answers, so a misconfigured URL in the list cannot serve one request.
   */
  networkPassphrase: string;
  failureThreshold?: number | undefined;
  baseCooldownMs?: number | undefined;
  maxBackoffMs?: number | undefined;
  /** Per-request timeout in milliseconds, handed to each `rpc.Server`. */
  timeout?: number | undefined;
  allowHttp?: boolean | undefined;
  headers?: Record<string, string> | undefined;
  onFailover?: ((from: string, to: string, error: Error) => void) | undefined;
  isEndpointFailure?: ((error: unknown) => boolean) | undefined;
  /** Replaces `new rpc.Server(url, …)`; the tests hand in doubles. */
  serverFactory?: ((url: string) => Server) | undefined;
  now?: (() => number) | undefined;
}

/**
 * An `rpc.Server` that walks a list of endpoints, plus the health of each.
 * `endpointHealth` is this package's ledger; `getHealth` stays the RPC
 * method of that name, dispatched like every other.
 */
export type FailoverRpc = Server & {
  endpointHealth(): EndpointHealth[];
  readonly endpoints: readonly string[];
};

export class RpcEndpointCooldownError extends Error {
  readonly url: string;
  readonly cooldownUntil: number;

  constructor(url: string, cooldownUntil: number) {
    super(`rpc endpoint ${url} is cooling down until ${new Date(cooldownUntil).toISOString()}`);
    this.name = "RpcEndpointCooldownError";
    this.url = url;
    this.cooldownUntil = cooldownUntil;
  }
}

export class NoUsableEndpointError extends Error {
  constructor(readonly health: EndpointHealth[]) {
    super(`no rpc endpoint is on the expected network: ${health.map((endpoint) => `${endpoint.url} (${endpoint.wrongNetwork ?? "unverified"})`).join(", ")}`);
    this.name = "NoUsableEndpointError";
  }
}

interface EndpointState {
  url: string;
  server: Server;
  verified: boolean;
  wrongNetwork: string | undefined;
  consecutiveFailures: number;
  cooldownUntil: number | undefined;
  lastError: string | undefined;
  lastFailureAt: number | undefined;
  lastSuccessAt: number | undefined;
}

const REQUEST_SCOPED_JSON_RPC_CODES = new Set([-32700, -32600, -32601, -32602]);
const PERMANENT_JSON_RPC_CODES = new Set([-32600, -32601, -32602, -32603]);
const TRANSPORT_MESSAGE =
  /timeout|timed out|took too long|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|EPIPE|socket|network|unable to connect|other side closed|terminated|Maximum number of redirects|maxContentLength/i;
const MAX_CAUSE_DEPTH = 8;

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (chain.length < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function jsonRpcCode(candidate: unknown): number | undefined {
  const code = (candidate as { code?: unknown }).code;
  if (typeof code === "number" && Number.isInteger(code)) return code;
  if (typeof code === "string" && /^-?\d+$/.test(code)) return Number(code);
  return undefined;
}

function httpStatus(candidate: unknown): number | undefined {
  const response = (candidate as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function errorMessage(candidate: unknown): string | undefined {
  const message = (candidate as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

/**
 * Whether an error is the endpoint's fault, so that the next endpoint should
 * be tried and this one's health ledger moved, or an answer the node gave,
 * which every endpoint would repeat.
 *
 * The SDK's `rpc.Server` produces three shapes. A transport failure (the
 * fetch threw, the request timed out, the response was not 2xx, with the
 * status on `error.response`) is the endpoint's. A JSON-RPC error, thrown as
 * the bare `{ code, message }` object, is the endpoint's unless its code is
 * one of the deterministic request errors (`-32700` parse, `-32600` invalid
 * request, `-32601` method not found, `-32602` invalid params), which every
 * endpoint would answer alike. An `Error` the SDK raised after a successful
 * round trip ("failed to find an entry for key …", a trustline not found) is
 * an answer, not an outage, and is spared: without that rule a keeper reading
 * an entry that does not exist yet would cool its primary endpoint down for
 * an answer the node gave correctly. Simulation failures are results, never
 * errors, so they never come through here. The rule is read through the
 * `cause` chain, and the first link that decides wins.
 */
export function isEndpointFailure(error: unknown): boolean {
  // Something that is not even an object is nothing the node answered.
  if (typeof error !== "object" || error === null) return true;
  for (const link of causeChain(error)) {
    if (httpStatus(link) !== undefined) return true;
    const code = jsonRpcCode(link);
    if (code !== undefined) return !REQUEST_SCOPED_JSON_RPC_CODES.has(code);
    if (link instanceof TypeError) return true;
    const message = errorMessage(link);
    if (message !== undefined && TRANSPORT_MESSAGE.test(message)) return true;
    if ((link as { name?: unknown }).name === "TimeoutError") return true;
  }
  return false;
}

/**
 * One `rpc.Server` over several endpoints. Every method of `Server` is
 * dispatched to the first endpoint that is not cooling down; an endpoint
 * failure (`isEndpointFailure`) moves the request to the next one and
 * counts against the endpoint, an answer the node gave is returned or thrown
 * as is. Before an endpoint serves its first request it is asked
 * `getNetwork`, and one on another network is excluded for good.
 *
 * An endpoint that fails `failureThreshold` requests in a row enters a
 * cooldown of `baseCooldownMs * 2^n` capped at `maxBackoffMs`; a cooling
 * endpoint is skipped as long as a healthier one follows it in the list and
 * tried again once the cooldown ends. When every endpoint is cooling down the
 * request still goes to them in order, so an outage degrades the client
 * instead of failing it closed.
 *
 * The result is typed as `Server`, so it goes wherever one goes: the Stellar
 * client's `rpc` option, a bindings client's `server`.
 */
export function createFailoverRpc(urls: readonly string[], options: FailoverRpcOptions): FailoverRpc {
  if (urls.length === 0) throw new TypeError("createFailoverRpc needs at least one url");
  const now = options.now ?? Date.now;
  const failureThreshold = Math.max(1, options.failureThreshold ?? 1);
  const baseCooldownMs = options.baseCooldownMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 60_000;
  const countsAsEndpointFailure = options.isEndpointFailure ?? isEndpointFailure;
  const serverFactory =
    options.serverFactory ??
    ((url: string) =>
      new Server(url, {
        ...(options.allowHttp !== undefined ? { allowHttp: options.allowHttp } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
      }));
  const endpoints: EndpointState[] = urls.map((url) => ({
    url,
    server: serverFactory(url),
    verified: false,
    wrongNetwork: undefined,
    consecutiveFailures: 0,
    cooldownUntil: undefined,
    lastError: undefined,
    lastFailureAt: undefined,
    lastSuccessAt: undefined,
  }));

  const isCoolingDown = (endpoint: EndpointState): boolean => endpoint.cooldownUntil !== undefined && endpoint.cooldownUntil > now();
  const isUsable = (endpoint: EndpointState): boolean => endpoint.wrongNetwork === undefined;
  const healthierFollows = (index: number): boolean => endpoints.slice(index + 1).some((endpoint) => isUsable(endpoint) && !isCoolingDown(endpoint));

  const recordSuccess = (endpoint: EndpointState): void => {
    endpoint.consecutiveFailures = 0;
    endpoint.cooldownUntil = undefined;
    endpoint.lastSuccessAt = now();
  };

  const recordFailure = (endpoint: EndpointState, error: Error): void => {
    endpoint.lastError = error.message;
    endpoint.lastFailureAt = now();
    endpoint.consecutiveFailures += 1;
    if (endpoint.consecutiveFailures < failureThreshold) return;
    const exponent = endpoint.consecutiveFailures - failureThreshold;
    endpoint.cooldownUntil = now() + Math.min(maxBackoffMs, baseCooldownMs * 2 ** exponent);
  };

  const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error));

  /**
   * The passphrase check, once per endpoint, before its first request. A
   * transport failure here counts like any other and moves on; a wrong
   * network excludes the endpoint.
   */
  const verify = async (endpoint: EndpointState): Promise<void> => {
    const network = await endpoint.server.getNetwork();
    if (network.passphrase !== options.networkPassphrase) {
      endpoint.wrongNetwork = network.passphrase;
      endpoint.lastError = `on "${network.passphrase}", expected "${options.networkPassphrase}"`;
      endpoint.lastFailureAt = now();
      return;
    }
    endpoint.verified = true;
  };

  const endpointHealth = (): EndpointHealth[] =>
    endpoints.map((endpoint) => ({
      url: endpoint.url,
      healthy: isUsable(endpoint) && !isCoolingDown(endpoint),
      wrongNetwork: endpoint.wrongNetwork,
      consecutiveFailures: endpoint.consecutiveFailures,
      cooldownUntil: isCoolingDown(endpoint) ? endpoint.cooldownUntil : undefined,
      lastError: endpoint.lastError,
      lastFailureAt: endpoint.lastFailureAt,
      lastSuccessAt: endpoint.lastSuccessAt,
    }));

  const dispatch = async (method: string, args: unknown[]): Promise<unknown> => {
    let lastFailure: { url: string; error: Error } | undefined;
    for (const [index, endpoint] of endpoints.entries()) {
      if (!isUsable(endpoint)) continue;
      if (isCoolingDown(endpoint) && healthierFollows(index)) continue;
      if (lastFailure !== undefined) options.onFailover?.(lastFailure.url, endpoint.url, lastFailure.error);
      try {
        if (!endpoint.verified) {
          await verify(endpoint);
          if (!isUsable(endpoint)) continue;
        }
        const target = endpoint.server as unknown as Record<string, (...params: unknown[]) => Promise<unknown>>;
        const fn = target[method];
        if (typeof fn !== "function") throw new TypeError(`rpc.Server has no method ${method}`);
        const result = await fn.apply(endpoint.server, args);
        recordSuccess(endpoint);
        return result;
      } catch (error) {
        if (!countsAsEndpointFailure(error)) throw error;
        const failure = asError(error);
        recordFailure(endpoint, failure);
        lastFailure = { url: endpoint.url, error: failure };
      }
    }
    if (lastFailure !== undefined) throw lastFailure.error;
    throw new NoUsableEndpointError(endpointHealth());
  };

  const primary = endpoints[0]!.server;
  const extras: Record<string, unknown> = { endpointHealth, endpoints: urls.slice() };
  return new Proxy(primary, {
    get(target, property, receiver) {
      if (typeof property === "string" && Object.hasOwn(extras, property)) return extras[property];
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || typeof property !== "string") return value;
      return (...args: unknown[]) => dispatch(property, args);
    },
  }) as FailoverRpc;
}

export interface RpcRetryOptions {
  attempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  isRetryable?: ((error: unknown) => boolean) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  signal?: AbortSignal | undefined;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether another attempt is pointless: a deterministic JSON-RPC error
 * (`-32600` to `-32603`), read from the error and its `cause` chain. A
 * different question from `isEndpointFailure`: `-32603` is permanent for the
 * retry loop and still the endpoint's fault for the failover.
 */
export function isPermanentRpcError(error: unknown): boolean {
  for (const link of causeChain(error)) {
    const code = jsonRpcCode(link);
    if (code !== undefined && PERMANENT_JSON_RPC_CODES.has(code)) return true;
  }
  return false;
}

const defaultIsRetryable = (error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return false;
  return !isPermanentRpcError(error);
};

async function sleepUntilElapsedOrAborted(sleep: (ms: number) => Promise<void>, ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal === undefined) {
    await sleep(ms);
    return false;
  }
  if (signal.aborted) return true;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      onAbort = () => resolve(true);
      signal.addEventListener("abort", onAbort, { once: true });
      sleep(ms).then(() => resolve(false), reject);
    });
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

export function jitteredBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export async function withRpcRetry<T>(fn: (attempt: number) => Promise<T>, options: RpcRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  options.signal?.throwIfAborted();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || options.signal?.aborted || !isRetryable(error)) throw error;
      const delayMs = jitteredBackoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      if (await sleepUntilElapsedOrAborted(sleep, delayMs, options.signal)) throw error;
    }
  }
}
