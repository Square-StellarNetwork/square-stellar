import Anthropic from "@anthropic-ai/sdk";
import { createStellarAgent, fileStore, type ProviderChain, type ProviderEvent, type StellarAgent } from "@squaresdk/agent/stellar";
import type { Signer, SquareDeployment } from "@squaresdk/core/stellar";
import type { HostedAgentConfig } from "./config.js";
import { sealContext } from "./host.js";
import { DEFAULT_MODEL, runCapability, type ModelClient, type RunOutcome } from "./model.js";
import { deriveSealKey, open } from "./sealed.js";

export interface StellarHostDeps {
  deployment: SquareDeployment;
  /** The key jobs are created for: it submits and withdraws. */
  signer: Signer;
  rpcUrl?: string | undefined;
  /** For tests: the chain the loop runs against, in place of the client's. */
  chain?: ProviderChain | undefined;
  /** As in `HostDeps`: a client, or a factory per tier. Default `new Anthropic()` / `new Anthropic({ apiKey })`. */
  anthropic?: ModelClient | ((apiKey: string | undefined) => ModelClient) | undefined;
  sealSecret?: string | undefined;
  /** Where the provider loop keeps its state across restarts; in memory when omitted. */
  stateFile?: string | undefined;
  /** The ledger to start looking for jobs from; the latest when omitted. */
  startLedger?: number | undefined;
  pollMs?: number | undefined;
  handlerTimeoutMs?: number | undefined;
  onRun?: ((event: { jobId: bigint; capability: string; outcome: RunOutcome }) => void) | undefined;
  onEvent?: ((event: ProviderEvent) => void) | undefined;
}

export interface StellarHostedAgent {
  readonly config: HostedAgentConfig;
  readonly agent: StellarAgent;
  readonly model: ModelClient;
}

/**
 * The institution's agent on Stellar, the MVP: every capability in the
 * configuration is a capability of a `@squaresdk/agent/stellar` agent whose
 * handler is a model run on the job's description, with the capability's
 * instructions. No MCP tools, delegation or compliance duty here (phase 2);
 * a configuration that asks for them is refused rather than half-honoured.
 * The model's key is the platform's or the institution's own, sealed at
 * rest and opened here, as on the EVM host.
 */
export function hostStellarAgent(config: HostedAgentConfig, deps: StellarHostDeps): StellarHostedAgent {
  if (config.tools && config.tools.length > 0) throw new Error(`${config.name}: MCP tools are not served on Stellar yet (phase 2); remove the tools block`);
  if (config.delegation) throw new Error(`${config.name}: delegation is not served on Stellar yet (phase 2); remove the delegation block`);
  if (config.compliance) throw new Error(`${config.name}: the compliance duty is not served on Stellar yet (phase 2); remove the compliance block`);
  if (config.capabilities.some((c) => c.delegate)) throw new Error(`${config.name}: a capability that delegates is not served on Stellar yet (phase 2)`);

  const model = modelClientFor(config, deps);
  const modelName = config.provider.model ?? DEFAULT_MODEL;
  const agent = createStellarAgent({
    name: config.name,
    description: config.description,
    deployment: deps.deployment,
    signer: deps.signer,
    rpc: deps.rpcUrl,
    chain: deps.chain,
    startLedger: deps.startLedger,
    store: deps.stateFile !== undefined ? fileStore(deps.stateFile) : undefined,
    pollMs: deps.pollMs,
    handlerTimeoutMs: deps.handlerTimeoutMs,
    onEvent: deps.onEvent,
    ...(config.capabilities.length === 1 ? { defaultCapability: config.capabilities[0]!.id } : {}),
  });
  for (const capability of config.capabilities) {
    agent.capability(capability.id, {
      description: capability.description,
      price: capability.price,
      handler: async (call) => {
        const outcome = await runCapability({
          client: model,
          model: modelName,
          instructions: capability.instructions,
          capability: capability.id,
          input: call.input,
          tools: [],
          maxTurns: config.maxTurns,
          signal: call.signal,
          execute: async (name) => ({ content: `no tool ${name} is served here`, isError: true }),
        });
        deps.onRun?.({ jobId: call.jobId, capability: capability.id, outcome });
        return outcome.text;
      },
    });
  }
  return { config, agent, model };
}

function modelClientFor(config: HostedAgentConfig, deps: StellarHostDeps): ModelClient {
  const provider = config.provider;
  let apiKey: string | undefined;
  if (provider.tier === "own") {
    if (deps.sealSecret === undefined) throw new Error(`${config.name} brings its own key, and the host has no seal secret to open it with`);
    apiKey = open(provider.apiKey, deriveSealKey(deps.sealSecret), sealContext(config));
  }
  if (typeof deps.anthropic === "function") return deps.anthropic(apiKey);
  if (deps.anthropic !== undefined) {
    if (provider.tier === "own") throw new Error(`${config.name} brings its own key; pass a factory as anthropic, not a client`);
    return deps.anthropic;
  }
  return apiKey === undefined ? new Anthropic() : new Anthropic({ apiKey });
}
