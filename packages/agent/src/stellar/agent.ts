import { serve } from "@hono/node-server";
import { createSquareClient, JOB_STATUS_NAMES, usdcUnits, type Signer, type SquareClient, type SquareDeployment } from "@squaresdk/core/stellar";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { chainOf, type ProviderChain } from "./chain.js";
import { createProvider, memoryStore, type JobHandler, type Provider, type ProviderEvent, type ProviderStore, type TrackedJob } from "./provider.js";

export interface StellarCapabilityOptions {
  description: string;
  /**
   * Decimal, in the payment token (XLM on testnet): what the agent asks for.
   * Shown to hirers, and enforced here rather than by the kernel: a job
   * funded below it is not worked.
   */
  price?: string | undefined;
  handler: JobHandler;
}

export interface StellarAgentOptions {
  name: string;
  description: string;
  /** The provider's client: its signer is the address jobs are created for and that submits and withdraws. */
  client?: SquareClient | undefined;
  /** Or what makes one. */
  deployment?: SquareDeployment | undefined;
  signer?: Signer | undefined;
  rpc?: string | undefined;
  /** For tests: the chain the loop runs against, in place of the client's. */
  chain?: ProviderChain | undefined;
  defaultCapability?: string | undefined;
  startLedger?: number | undefined;
  store?: ProviderStore | undefined;
  pollMs?: number | undefined;
  maxAttempts?: number | undefined;
  handlerTimeoutMs?: number | undefined;
  onEvent?: ((event: ProviderEvent) => void) | undefined;
  /**
   * Which origins may read the agent from a browser: the hirer's app fetches
   * the deliverable cross-origin. Every origin by default (everything served
   * is public and read-only); a list to restrict, `false` to send no CORS
   * headers.
   */
  cors?: string | string[] | false | undefined;
}

export interface StellarListening {
  url: string;
  close(): Promise<void>;
}

export interface StellarAgent {
  readonly name: string;
  readonly account: string;
  readonly client: SquareClient | undefined;
  readonly provider: Provider;
  /** What the agent serves, as a fetch handler; `listen` puts it on a port. */
  readonly app: Hono;
  capability(id: string, options: StellarCapabilityOptions): StellarAgent;
  capabilities(): Array<{ id: string; description: string; price?: string | undefined }>;
  /** Starts the loop (`pollMs`, default 10 s) and serves. */
  listen(port: number, hostname?: string): Promise<StellarListening>;
  /** Starts the loop alone, for a process that serves nothing. */
  start(): void;
  stop(): Promise<void>;
}

const DEFAULT_POLL_MS = 10_000;

/**
 * An agent for hire on Stellar, the MVP: declare what it does, give it the
 * key jobs are created for, listen. It watches the kernel for jobs naming it
 * as provider, works each once funded, submits, finalizes after the window
 * and withdraws (`createProvider`), and leaves alone a job funded below the
 * capability's price; and it serves what the hirer needs after paying: the
 * deliverable behind the hash on chain, readable from a browser (CORS).
 *
 *   GET /health                      name, account, what it is tracking
 *   GET /capabilities                what it does and asks for
 *   GET /jobs                        every job it has seen, as the loop keeps them
 *   GET /jobs/:id                    one of them
 *   GET /jobs/:id/deliverable        the content whose hash `submit` put on chain
 *
 * No card, DID or A2A endpoint here: those come with the 8004 registries
 * (phase 2); the job's description is the work order.
 */
export function createStellarAgent(options: StellarAgentOptions): StellarAgent {
  let client = options.client;
  if (!client && !options.chain) {
    if (!options.deployment || !options.signer) throw new Error("createStellarAgent needs a client, or a deployment and a signer");
    client = createSquareClient({ deployment: options.deployment, signer: options.signer, rpc: options.rpc });
  }
  const chain = options.chain ?? chainOf(client!);
  const declared = new Map<string, StellarCapabilityOptions>();
  const handlers: Record<string, JobHandler> = {};
  const provider = createProvider({
    chain,
    handlers,
    minimumBudgetFor: (id) => {
      const price = declared.get(id)?.price;
      return price === undefined ? undefined : usdcUnits(price);
    },
    defaultCapability: options.defaultCapability,
    startLedger: options.startLedger,
    store: options.store ?? memoryStore(),
    maxAttempts: options.maxAttempts,
    handlerTimeoutMs: options.handlerTimeoutMs,
    onEvent: options.onEvent,
  });

  const capabilities = () => [...declared.entries()].map(([id, c]) => ({ id, description: c.description, ...(c.price !== undefined ? { price: c.price } : {}) }));

  const app = new Hono();
  if (options.cors !== false) app.use("*", cors({ origin: options.cors ?? "*", allowMethods: ["GET", "OPTIONS"] }));
  app.get("/health", (c) =>
    c.json({
      name: options.name,
      description: options.description,
      account: chain.account,
      network: client?.deployment.network,
      kernel: client?.deployment.squareJob,
      tracking: provider.jobs().filter((job) => !job.done).length,
    }),
  );
  app.get("/capabilities", (c) => c.json({ capabilities: capabilities(), defaultCapability: options.defaultCapability ?? (declared.size === 1 ? [...declared.keys()][0] : undefined) }));
  app.get("/jobs", (c) => c.json({ jobs: provider.jobs().map(publicView) }));
  app.get("/jobs/:id", (c) => {
    const job = tracked(c.req.param("id"));
    return job ? c.json(publicView(job)) : c.json({ error: "no such job here" }, 404);
  });
  app.get("/jobs/:id/deliverable", (c) => {
    const job = tracked(c.req.param("id"));
    if (!job) return c.json({ error: "no such job here" }, 404);
    if (job.deliverable === undefined || job.content === undefined) return c.json({ error: `job ${job.jobId} has not been delivered` }, 404);
    return c.json({ jobId: job.jobId, capability: job.capability, deliverable: job.deliverable, content: job.content, submittedIn: job.submittedIn });
  });

  function tracked(id: string): TrackedJob | undefined {
    return /^[0-9]+$/.test(id) ? provider.job(BigInt(id)) : undefined;
  }

  const agent: StellarAgent = {
    name: options.name,
    account: chain.account,
    client,
    provider,
    app,
    capability(id, capabilityOptions) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`capability id ${JSON.stringify(id)}: lowercase letters, digits, dots, dashes`);
      declared.set(id, capabilityOptions);
      handlers[id] = capabilityOptions.handler;
      return agent;
    },
    capabilities,
    start() {
      provider.start(options.pollMs ?? DEFAULT_POLL_MS);
    },
    stop: () => provider.stop(),
    async listen(port, hostname = "0.0.0.0") {
      agent.start();
      const server = serve({ fetch: app.fetch, port, hostname });
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const bound = server.address();
      const actualPort = typeof bound === "object" && bound !== null ? bound.port : port;
      return {
        url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${actualPort}`,
        close: async () => {
          await provider.stop();
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        },
      };
    },
  };
  return agent;
}

/** The tracked job as served: the content only through its own route. */
function publicView(job: TrackedJob): Omit<TrackedJob, "content"> & { delivered: boolean } {
  const { content, ...rest } = job;
  return { ...rest, delivered: content !== undefined && job.deliverable !== undefined };
}

export { JOB_STATUS_NAMES };
