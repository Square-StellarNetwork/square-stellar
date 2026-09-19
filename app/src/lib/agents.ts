import { formatDid, parseDid, InvalidDidError } from "@squaresdk/did-resolver";
import type { Address } from "viem";

/**
 * The agent side of the app (square#agents): the registration file an owner
 * writes for an ERC-8004 identity, where the app keeps the agents a wallet
 * registered, and how a DID or an id typed into the resolver is read. Every
 * function here is pure so it is tested without a chain; the chain calls
 * live in identity.ts.
 */

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export const X_AIP_TYPE = "https://github.com/Square-StellarNetwork/square/blob/main/docs/agent-card/README.md#v1";
export const AGENT_TYPES = ["LLM", "Task", "Execution"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/** docs/agent-card/schema.json: the bounds the form enforces before the file is built. */
export const CARD_LIMITS = { name: 128, description: 4096, capabilityId: 64, capabilityDescription: 256, capabilities: 64, slug: 32, version: 32 } as const;
const CAPABILITY_ID = /^[a-z0-9]+(\.[a-z0-9]+)*$/;
const SLUG = /^[a-zA-Z0-9_-]{1,32}$/;
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;

export interface CapabilityForm {
  id: string;
  description: string;
  /** Decimal USDC per call; empty means the capability carries no price. */
  price: string;
}

export interface CardForm {
  name: string;
  description: string;
  image: string;
  web: string;
  a2a: string;
  mcp: string;
  email: string;
  x402: boolean;
  agentType: AgentType;
  slug: string;
  version: string;
  capabilities: CapabilityForm[];
}

export const EMPTY_CARD_FORM: CardForm = {
  name: "",
  description: "",
  image: "",
  web: "",
  a2a: "",
  mcp: "",
  email: "",
  x402: false,
  agentType: "LLM",
  slug: "",
  version: "",
  capabilities: [],
};

export interface CardService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface CardCapability {
  id: string;
  description: string;
  pricing?: { amount: string; token: string; network: string };
}

/** The registration file, in the shape docs/agent-card/schema.json accepts. */
export interface RegistrationCard {
  type: typeof REGISTRATION_TYPE;
  name: string;
  description: string;
  image?: string;
  services?: CardService[];
  x402Support?: boolean;
  active: boolean;
  "x-aip"?: {
    type: typeof X_AIP_TYPE;
    agentType: AgentType;
    slug?: string;
    agentVersion?: string;
    capabilities: CardCapability[];
  };
}

export type CardErrors = Partial<Record<keyof CardForm, string>> & { capabilityRows?: Record<number, string> };

export type CardResult = { kind: "card"; card: RegistrationCard } | { kind: "invalid"; errors: CardErrors };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** `image` is `format: uri` in the schema; https and ipfs are what a card can actually be read from. */
function isImageUri(value: string): boolean {
  return isHttpsUrl(value) || /^ipfs:\/\/[A-Za-z0-9]+/.test(value);
}

/**
 * Build the registration file from the form, or say which field is wrong.
 * The pricing of a capability names the settlement token and the chain the
 * card is for, in CAIP-2, so it is bound to the deployment the app runs on.
 */
export function cardFromForm(form: CardForm, settlement: { usdc: Address; chainId: number }): CardResult {
  const errors: CardErrors = {};
  const name = form.name.trim();
  const description = form.description.trim();
  if (name.length === 0) errors.name = "Give the agent a name.";
  else if (name.length > CARD_LIMITS.name) errors.name = `At most ${CARD_LIMITS.name} characters.`;
  if (description.length === 0) errors.description = "Describe what the agent does.";
  else if (description.length > CARD_LIMITS.description) errors.description = `At most ${CARD_LIMITS.description} characters.`;
  const image = form.image.trim();
  if (image.length > 0 && !isImageUri(image)) errors.image = "An https:// or ipfs:// URI.";
  const web = form.web.trim();
  if (web.length > 0 && !isHttpsUrl(web)) errors.web = "An https:// URL.";
  const a2a = form.a2a.trim();
  if (a2a.length > 0 && !isHttpsUrl(a2a)) errors.a2a = "An https:// URL; the A2A endpoint agents post tasks to.";
  const mcp = form.mcp.trim();
  if (mcp.length > 0 && !isHttpsUrl(mcp)) errors.mcp = "An https:// URL.";
  const email = form.email.trim();
  if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "An email address.";
  const slug = form.slug.trim();
  if (slug.length > 0 && !SLUG.test(slug)) errors.slug = "Letters, digits, - and _, at most 32.";
  const version = form.version.trim();
  if (version.length > CARD_LIMITS.version) errors.version = `At most ${CARD_LIMITS.version} characters.`;

  const rows: Record<number, string> = {};
  const capabilities: CardCapability[] = [];
  if (form.capabilities.length > CARD_LIMITS.capabilities) errors.capabilities = `At most ${CARD_LIMITS.capabilities} capabilities.`;
  const seen = new Set<string>();
  form.capabilities.forEach((row, index) => {
    const id = row.id.trim();
    const text = row.description.trim();
    const price = row.price.trim();
    if (id.length === 0 && text.length === 0 && price.length === 0) return; // an empty row is not a capability
    if (!CAPABILITY_ID.test(id) || id.length > CARD_LIMITS.capabilityId) {
      rows[index] = "A dotted lowercase id such as text.summarize.";
      return;
    }
    if (seen.has(id)) {
      rows[index] = `${id} is listed twice.`;
      return;
    }
    if (text.length === 0 || text.length > CARD_LIMITS.capabilityDescription) {
      rows[index] = `A description of 1 to ${CARD_LIMITS.capabilityDescription} characters.`;
      return;
    }
    if (price.length > 0 && !AMOUNT.test(price)) {
      rows[index] = "A decimal USDC amount, such as 0.05, or leave it empty.";
      return;
    }
    seen.add(id);
    capabilities.push({
      id,
      description: text,
      ...(price.length > 0 ? { pricing: { amount: price, token: settlement.usdc.toLowerCase(), network: `eip155:${settlement.chainId}` } } : {}),
    });
  });
  if (Object.keys(rows).length > 0) errors.capabilityRows = rows;
  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };

  const services: CardService[] = [];
  if (web.length > 0) services.push({ name: "web", endpoint: web });
  if (a2a.length > 0) services.push({ name: "A2A", endpoint: a2a, version: "0.3.0" });
  if (mcp.length > 0) services.push({ name: "MCP", endpoint: mcp });
  if (email.length > 0) services.push({ name: "email", endpoint: email });

  const card: RegistrationCard = {
    type: REGISTRATION_TYPE,
    name,
    description,
    ...(image.length > 0 ? { image } : {}),
    ...(services.length > 0 ? { services } : {}),
    ...(form.x402 ? { x402Support: true } : {}),
    active: true,
    ...(capabilities.length > 0
      ? {
          "x-aip": {
            type: X_AIP_TYPE,
            agentType: form.agentType,
            ...(slug.length > 0 ? { slug } : {}),
            ...(version.length > 0 ? { agentVersion: version } : {}),
            capabilities,
          },
        }
      : {}),
  };
  return { kind: "card", card };
}

/** The card as a `data:` URI: compact JSON, base64, the form the smoke agents are registered with. */
export function cardDataUri(card: RegistrationCard): string {
  const json = JSON.stringify(card);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/json;base64,${btoa(binary)}`;
}

/** How many bytes the chain stores for a `data:` URI card; what the registration pays for. */
export function cardUriBytes(uri: string): number {
  return new TextEncoder().encode(uri).length;
}

export type AgentUriKind = "https" | "ipfs" | "data" | "empty" | "invalid";

/** What kind of agentURI a string is, by the schemes ERC-8004 allows and the resolver reads. */
export function agentUriKind(uri: string): AgentUriKind {
  const trimmed = uri.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith("data:application/json")) return "data";
  if (/^ipfs:\/\/[A-Za-z0-9]+/.test(trimmed)) return "ipfs";
  if (isHttpsUrl(trimmed)) return "https";
  return "invalid";
}

export type AgentLookup = { kind: "did"; did: string } | { kind: "invalid"; message: string } | { kind: "empty" };

/**
 * What was typed into the resolver: a did:aip identifier as is, or a bare
 * agent id read against this deployment's registry.
 */
export function parseAgentLookup(input: string, registry: { chainId: number; identityRegistry: Address }): AgentLookup {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (/^\d+$/.test(trimmed)) return { kind: "did", did: formatDid(registry.chainId, registry.identityRegistry, BigInt(trimmed)) };
  if (trimmed.startsWith("did:")) {
    try {
      const parsed = parseDid(trimmed);
      if (parsed.version === 1) return { kind: "invalid", message: "A did:aip v1 (Solana) identifier; this app resolves v2 identifiers on this chain." };
      return { kind: "did", did: trimmed };
    } catch (error) {
      return { kind: "invalid", message: error instanceof InvalidDidError ? error.message : "Not a did:aip identifier." };
    }
  }
  return { kind: "invalid", message: "Enter an agent id, or a did:aip identifier." };
}

// ------------------------------------------------------------ the wallet's agents

export interface StoredAgent {
  did: string;
  agentId: string;
  name: string | null;
  /** The registration transaction, when this app sent it; null for an agent added by id. */
  txHash: string | null;
  addedAt: number;
}

function agentsKey(chainId: number, owner: Address): string {
  return `square.agents.${chainId}.${owner.toLowerCase()}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredAgents(chainId: number, owner: Address): StoredAgent[] {
  const raw = storage()?.getItem(agentsKey(chainId, owner));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StoredAgent => typeof entry === "object" && entry !== null && typeof (entry as StoredAgent).did === "string");
  } catch {
    return [];
  }
}

/** Adds or replaces an agent by DID; the newest first. Pure over the list so it is tested without a browser. */
export function withStoredAgent(list: StoredAgent[], agent: StoredAgent): StoredAgent[] {
  return [agent, ...list.filter((entry) => entry.did !== agent.did)];
}

export function storeAgents(chainId: number, owner: Address, list: StoredAgent[]): void {
  storage()?.setItem(agentsKey(chainId, owner), JSON.stringify(list));
}
