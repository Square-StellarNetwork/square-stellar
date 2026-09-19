import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { agentUriKind, cardDataUri, cardFromForm, cardUriBytes, EMPTY_CARD_FORM, parseAgentLookup, withStoredAgent, type CardForm, type StoredAgent } from "./agents";

const USDC = "0x3600000000000000000000000000000000000000" as const;
const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const SETTLEMENT = { usdc: USDC, chainId: 5042002 };
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/agent-card/schema.json", import.meta.url)), "utf8"));
const validate = addFormats(new Ajv2020({ allErrors: true, strict: false })).compile(schema);

const full: CardForm = {
  ...EMPTY_CARD_FORM,
  name: "Atlas",
  description: "A research agent.",
  image: "ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  web: "https://atlas.example/",
  a2a: "https://atlas.example/a2a",
  mcp: "https://mcp.atlas.example/",
  email: "ops@atlas.example",
  x402: true,
  agentType: "Task",
  slug: "atlas",
  version: "3.0.1",
  capabilities: [
    { id: "text.summarize", description: "Summarise documents into a brief.", price: "0.05" },
    { id: "research.brief", description: "A cited brief on a question.", price: "" },
  ],
};

describe("the registration file built from the form", () => {
  it("is valid against docs/agent-card/schema.json with everything filled in", () => {
    const built = cardFromForm(full, SETTLEMENT);
    expect(built.kind).toBe("card");
    if (built.kind !== "card") return;
    expect(validate(built.card)).toBe(true);
    expect(built.card.services?.map((service) => service.name)).toEqual(["web", "A2A", "MCP", "email"]);
    expect(built.card["x-aip"]?.capabilities).toEqual([
      { id: "text.summarize", description: "Summarise documents into a brief.", pricing: { amount: "0.05", token: USDC.toLowerCase(), network: "eip155:5042002" } },
      { id: "research.brief", description: "A cited brief on a question." },
    ]);
    expect(built.card.x402Support).toBe(true);
    expect(built.card.active).toBe(true);
  });

  it("is valid with only a name and a description, and then carries no services and no x-aip block", () => {
    const built = cardFromForm({ ...EMPTY_CARD_FORM, name: "Smoke", description: "Answers nothing." }, SETTLEMENT);
    expect(built.kind).toBe("card");
    if (built.kind !== "card") return;
    expect(validate(built.card)).toBe(true);
    expect(built.card).toEqual({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Smoke", description: "Answers nothing.", active: true });
  });

  it("ignores an empty capability row and refuses a malformed one by its row", () => {
    const blank = cardFromForm({ ...EMPTY_CARD_FORM, name: "A", description: "B", capabilities: [{ id: "", description: "", price: "" }] }, SETTLEMENT);
    expect(blank.kind).toBe("card");
    if (blank.kind === "card") expect(blank.card["x-aip"]).toBeUndefined();

    const bad = cardFromForm(
      { ...EMPTY_CARD_FORM, name: "A", description: "B", capabilities: [{ id: "Text.Summarize", description: "x", price: "" }, { id: "a.b", description: "ok", price: "1,5" }, { id: "a.b", description: "ok", price: "" }] },
      SETTLEMENT,
    );
    expect(bad.kind).toBe("invalid");
    if (bad.kind !== "invalid") return;
    expect(bad.errors.capabilityRows?.[0]).toMatch(/dotted lowercase/);
    expect(bad.errors.capabilityRows?.[1]).toMatch(/decimal USDC/);
    expect(bad.errors.capabilityRows?.[2]).toBeUndefined();
  });

  it("names the field that is wrong instead of building a card the schema would refuse", () => {
    const built = cardFromForm({ ...full, name: "", web: "ftp://x", email: "not-an-email", slug: "has space", image: "http://plain" }, SETTLEMENT);
    expect(built.kind).toBe("invalid");
    if (built.kind !== "invalid") return;
    expect(Object.keys(built.errors).sort()).toEqual(["email", "image", "name", "slug", "web"]);
  });

  it("encodes the card as the compact data: URI the registry stores", () => {
    const built = cardFromForm({ ...EMPTY_CARD_FORM, name: "Smoke", description: "Ünïcode too." }, SETTLEMENT);
    if (built.kind !== "card") throw new Error("expected a card");
    const uri = cardDataUri(built.card);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(uri.slice("data:application/json;base64,".length)), (c) => c.charCodeAt(0)));
    expect(JSON.parse(decoded)).toEqual(built.card);
    expect(cardUriBytes(uri)).toBe(new TextEncoder().encode(uri).length);
    expect(agentUriKind(uri)).toBe("data");
  });
});

describe("what an agentURI is", () => {
  it("tells the schemes apart and refuses http", () => {
    expect(agentUriKind("https://atlas.example/agent.json")).toBe("https");
    expect(agentUriKind("ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")).toBe("ipfs");
    expect(agentUriKind("   ")).toBe("empty");
    expect(agentUriKind("http://atlas.example/agent.json")).toBe("invalid");
    expect(agentUriKind("agent.json")).toBe("invalid");
  });
});

describe("what was typed into the resolver", () => {
  const registry = { chainId: 5042002, identityRegistry: REGISTRY };

  it("reads a bare id against this deployment's registry", () => {
    expect(parseAgentLookup(" 892531 ", registry)).toEqual({ kind: "did", did: `did:aip:eip155:5042002:${REGISTRY.toLowerCase()}:892531` });
  });

  it("passes a v2 DID through and refuses a v1 one by name", () => {
    const did = `did:aip:eip155:1:${REGISTRY.toLowerCase()}:7`;
    expect(parseAgentLookup(did, registry)).toEqual({ kind: "did", did });
    const v1 = parseAgentLookup("did:aip:5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG:atlas", registry);
    expect(v1.kind).toBe("invalid");
    if (v1.kind === "invalid") expect(v1.message).toMatch(/v1/);
  });

  it("is empty for nothing and invalid for anything else", () => {
    expect(parseAgentLookup("", registry)).toEqual({ kind: "empty" });
    expect(parseAgentLookup("did:web:x", registry).kind).toBe("invalid");
    expect(parseAgentLookup("atlas", registry).kind).toBe("invalid");
  });
});

describe("the wallet's agent list", () => {
  it("keeps the newest first and one entry per DID", () => {
    const a: StoredAgent = { did: "did:aip:eip155:1:0x00:1", agentId: "1", name: null, txHash: null, addedAt: 1 };
    const b: StoredAgent = { did: "did:aip:eip155:1:0x00:2", agentId: "2", name: "B", txHash: null, addedAt: 2 };
    const list = withStoredAgent(withStoredAgent([], a), b);
    expect(list.map((agent) => agent.agentId)).toEqual(["2", "1"]);
    expect(withStoredAgent(list, { ...a, name: "A again" }).map((agent) => [agent.agentId, agent.name])).toEqual([["1", "A again"], ["2", "B"]]);
  });
});
