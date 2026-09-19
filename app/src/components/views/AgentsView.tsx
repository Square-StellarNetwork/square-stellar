"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { AddressLink, TxLink } from "@/components/AddressLink";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Field, inputClass } from "@/components/Field";
import { GhostButton } from "@/components/GhostButton";
import { JsonEditor } from "@/components/JsonEditor";
import { PanelCard } from "@/components/PanelCard";
import { PillToggle } from "@/components/PillToggle";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { StatusPill } from "@/components/StatusPill";
import { WalletButton } from "@/components/WalletButton";
import {
  AGENT_TYPES,
  agentUriKind,
  cardDataUri,
  cardFromForm,
  cardUriBytes,
  EMPTY_CARD_FORM,
  parseAgentLookup,
  readStoredAgents,
  storeAgents,
  withStoredAgent,
  type CapabilityForm,
  type CardForm,
  type RegistrationCard,
  type StoredAgent,
} from "@/lib/agents";
import { formatTimestamp } from "@/lib/format";
import { registerAgent, useResolution, type Resolution } from "@/lib/identity";
import { describeError, useTx } from "@/lib/tx";
import { activeChain, deployment } from "@/lib/wagmi";

/**
 * The agent side of the protocol: register an ERC-8004 identity for the
 * connected wallet and resolve any did:aip on this chain. What the CLI does
 * with `square register` and `square resolve`, on a page.
 */
export function AgentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const { address, chainId } = useAccount();
  const initial = params.get("did") ?? "";
  const [lookup, setLookup] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  useEffect(() => {
    setLookup(initial);
    setSubmitted(initial);
  }, [initial]);
  const parsed = useMemo(() => parseAgentLookup(submitted, { chainId: activeChain.id, identityRegistry: deployment.identityRegistry }), [submitted]);
  const did = parsed.kind === "did" ? parsed.did : null;
  const resolution = useResolution(did);
  const canSend = address !== undefined && chainId === activeChain.id;
  const reason = address === undefined ? "Connect a wallet to register." : chainId !== activeChain.id ? `Switch the wallet to ${activeChain.name}.` : null;

  const resolve = (value: string) => {
    setSubmitted(value);
    const query = value.trim().length > 0 ? `?did=${encodeURIComponent(value.trim())}` : "";
    router.replace(`/agents${query}`);
  };

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading
        title="Agents"
        description="An agent is a wallet that owns an ERC-8004 identity. Register one for the connected wallet, and resolve any did:aip on this chain to the document and the card behind it."
      />
      <PanelCard title="Resolve an agent" description="An agent id on this deployment's Identity Registry, or a did:aip identifier. Read from the chain, then the registration file it names.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            resolve(lookup);
          }}
        >
          <Field label="Agent id or DID" htmlFor="lookup" error={parsed.kind === "invalid" ? parsed.message : null} hint={`Registry ${deployment.identityRegistry} on ${activeChain.name}.`}>
            <input id="lookup" className={`${inputClass} font-mono text-[13px]`} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder={`892531, or did:aip:eip155:${activeChain.id}:${deployment.identityRegistry.toLowerCase()}:892531`} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton size="sm" type="submit" disabled={lookup.trim().length === 0}>
              Resolve
            </PrimaryButton>
            {did !== null && resolution.isFetching ? <span className="text-caption text-graphite">Reading the registry…</span> : null}
          </div>
        </form>
        {did !== null && resolution.data ? <ResolutionResult did={did} resolution={resolution.data} /> : null}
        {did !== null && resolution.isError ? <p className="mt-4 text-caption text-magenta">{describeError(resolution.error)}</p> : null}
      </PanelCard>

      {address === undefined ? (
        <PanelCard title="Register an agent" description="The identity is an ERC-721 minted to the wallet that registers it; that wallet owns the agent and its registration file.">
          <EmptyState title="Connect the wallet that will own the agent" hint="Registration is permissionless; the agent id is whatever the registry mints next." action={<WalletButton />} />
        </PanelCard>
      ) : (
        <>
          <RegisterCard owner={address} canSend={canSend} reason={reason} onRegistered={(agent) => resolve(agent.did)} />
          <YourAgents owner={address} onResolve={resolve} />
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-ash">{label}</dt>
      <dd className="break-words text-body text-carbon">{children}</dd>
    </div>
  );
}

/** The CAIP-10 account behind a verification method, as an address. */
function accountOf(blockchainAccountId: string): string {
  return blockchainAccountId.split(":").pop() ?? blockchainAccountId;
}

function ResolutionResult({ did, resolution }: { did: string; resolution: Resolution }) {
  const { result, card } = resolution;
  const meta = result.didResolutionMetadata;
  const docMeta = result.didDocumentMetadata;
  const [showDocument, setShowDocument] = useState(false);
  if (result.didDocument === null) {
    return (
      <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-fog p-5">
        <StatusPill label={meta.error ?? "error"} tone="magenta" />
        <p className="text-caption text-graphite">{meta.errorMessage ?? "The DID could not be resolved."}</p>
        {meta.error === "notFound" ? <p className="text-caption text-graphite">The registry has no agent with this id: it was never minted, or it was burned.</p> : null}
      </div>
    );
  }
  const document = result.didDocument;
  const owner = document.verificationMethod.find((method) => method.id.endsWith("#owner"));
  const wallet = document.verificationMethod.find((method) => method.id.endsWith("#agent-wallet"));
  const warnings = meta.warnings ?? [];
  const capabilities = card?.["x-aip"]?.capabilities ?? [];
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={docMeta.deactivated ? "Deactivated" : "Active"} tone={docMeta.deactivated ? "magenta" : "mint"} />
        {docMeta.agentUriScheme ? <Chip>Card via {docMeta.agentUriScheme}</Chip> : <Chip dot="ash">No card</Chip>}
        {docMeta.registrationFile === "unavailable" ? <Chip dot="amber">Card unreadable</Chip> : null}
        {docMeta.versionId ? <span className="text-caption text-graphite">Read at block {docMeta.versionId}</span> : null}
      </div>
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Row label="DID">
          <span className="break-all font-mono text-[13px]">{document.id}</span>
        </Row>
        <Row label="Owner">{owner ? <AddressLink address={accountOf(owner.blockchainAccountId)} /> : <span className="text-ash">Unknown</span>}</Row>
        <Row label="Agent wallet">{wallet ? <AddressLink address={accountOf(wallet.blockchainAccountId)} /> : <span className="text-ash">Not set; the owner is paid</span>}</Row>
        <Row label="Registry">{docMeta.agentRegistry ?? "n/a"}</Row>
        {card ? (
          <>
            <Row label="Name">{card.name}</Row>
            <Row label="Description">{card.description}</Row>
            {card["x-aip"] ? (
              <Row label="Type">
                {card["x-aip"].agentType}
                {card["x-aip"].agentVersion ? <span className="text-caption text-graphite"> v{card["x-aip"].agentVersion}</span> : null}
                {card["x-aip"].slug ? <span className="text-caption text-graphite"> · {card["x-aip"].slug}</span> : null}
              </Row>
            ) : null}
            <Row label="x402">{card.x402Support ? <Chip dot="mint">Accepts per-call payments</Chip> : <span className="text-ash">Not advertised</span>}</Row>
          </>
        ) : null}
      </dl>
      {document.service.length > 0 ? (
        <div>
          <h3 className="text-caption font-medium text-carbon">Services</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {document.service.map((service) => (
              <li key={service.id} className="flex flex-wrap items-center gap-3 text-body">
                <Chip>{service.type}</Chip>
                <span className="break-all font-mono text-[13px] text-carbon">{service.serviceEndpoint}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {capabilities.length > 0 ? (
        <div>
          <h3 className="text-caption font-medium text-carbon">Capabilities</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {capabilities.map((capability) => (
              <li key={capability.id} className="flex flex-wrap items-baseline gap-3 text-body">
                <span className="font-mono text-[13px] text-carbon">{capability.id}</span>
                <span className="text-caption text-graphite">{capability.description}</span>
                {capability.pricing ? <Chip>{capability.pricing.amount} USDC per call</Chip> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {docMeta.crossRegistrations ? (
        <div>
          <h3 className="text-caption font-medium text-carbon">Cross-registrations</h3>
          <ul className="mt-2 flex flex-col gap-1 text-caption">
            {docMeta.crossRegistrations.verified.map((entry) => (
              <li key={entry} className="flex items-center gap-2 break-all font-mono text-[12px]">
                <Chip dot="mint">verified</Chip> {entry}
              </li>
            ))}
            {docMeta.crossRegistrations.unverified.map((entry) => (
              <li key={entry} className="flex items-center gap-2 break-all font-mono text-[12px]">
                <Chip dot="amber">unverified</Chip> {entry}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-caption text-graphite">
          {warnings.map((warning) => (
            <li key={warning.code}>
              {warning.code}: {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <GhostButton size="sm" onClick={() => void navigator.clipboard?.writeText(did)}>
          Copy DID
        </GhostButton>
        <GhostButton size="sm" onClick={() => setShowDocument((value) => !value)}>
          {showDocument ? "Hide the DID document" : "Show the DID document"}
        </GhostButton>
      </div>
      {showDocument ? <pre className="overflow-x-auto rounded-2xl bg-mist p-5 text-[12px] leading-relaxed text-carbon">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}

type Hosting = "data" | "hosted" | "none";

function RegisterCard({ owner, canSend, reason, onRegistered }: { owner: Address; canSend: boolean; reason: string | null; onRegistered: (agent: StoredAgent) => void }) {
  const { data: walletClient } = useWalletClient();
  const { notify, busy } = useTx();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CardForm>(EMPTY_CARD_FORM);
  const [hosting, setHosting] = useState<Hosting>("data");
  const [hostedUri, setHostedUri] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [registered, setRegistered] = useState<StoredAgent | null>(null);
  const built = useMemo(() => cardFromForm(form, { usdc: deployment.usdc, chainId: activeChain.id }), [form]);
  const errors = attempted && built.kind === "invalid" ? built.errors : {};
  const dataUri = built.kind === "card" ? cardDataUri(built.card) : null;
  const hostedKind = agentUriKind(hostedUri);
  const agentUri = hosting === "data" ? (dataUri ?? "") : hosting === "hosted" ? hostedUri.trim() : "";
  const ready = hosting === "none" || (hosting === "data" && built.kind === "card") || (hosting === "hosted" && (hostedKind === "https" || hostedKind === "ipfs"));

  const update = <K extends keyof CardForm>(key: K, value: CardForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateCapability = (index: number, patch: Partial<CapabilityForm>) =>
    setForm((current) => ({ ...current, capabilities: current.capabilities.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));

  const register = async () => {
    setAttempted(true);
    if (!ready || !walletClient) return;
    notify({ status: "pending", label: "Register agent" });
    try {
      const result = await registerAgent({ walletClient, owner, agentUri });
      const agent: StoredAgent = { did: result.did, agentId: result.agentId.toString(), name: built.kind === "card" && hosting === "data" ? built.card.name : null, txHash: result.hash, addedAt: Math.floor(Date.now() / 1000) };
      storeAgents(activeChain.id, owner, withStoredAgent(readStoredAgents(activeChain.id, owner), agent));
      setRegistered(agent);
      notify({ status: "success", label: "Register agent", hash: result.hash });
      await queryClient.invalidateQueries();
      onRegistered(agent);
    } catch (error) {
      notify({ status: "error", label: "Register agent", message: describeError(error) });
    }
  };

  return (
    <PanelCard
      title="Register an agent"
      description={`Mints an ERC-8004 identity to ${owner} on ${activeChain.name} and records the card's URI on it. The DID is derived from what the chain mints, never chosen.`}
    >
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Field label="Name" htmlFor="agent-name" error={errors.name ?? null}>
            <input id="agent-name" className={inputClass} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Atlas" maxLength={128} />
          </Field>
          <Field label="Description" htmlFor="agent-description" error={errors.description ?? null} hint="What the agent does, for whoever resolves it.">
            <textarea id="agent-description" rows={3} className={inputClass} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Retrieves sources, cross-checks claims and drafts briefs." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website" htmlFor="agent-web" error={errors.web ?? null}>
              <input id="agent-web" className={inputClass} value={form.web} onChange={(event) => update("web", event.target.value)} placeholder="https://atlas.example/" />
            </Field>
            <Field label="A2A endpoint" htmlFor="agent-a2a" error={errors.a2a ?? null} hint="Where tasks are posted; @squaresdk/agent serves /a2a.">
              <input id="agent-a2a" className={inputClass} value={form.a2a} onChange={(event) => update("a2a", event.target.value)} placeholder="https://atlas.example/a2a" />
            </Field>
            <Field label="MCP endpoint" htmlFor="agent-mcp" error={errors.mcp ?? null}>
              <input id="agent-mcp" className={inputClass} value={form.mcp} onChange={(event) => update("mcp", event.target.value)} placeholder="https://mcp.atlas.example/" />
            </Field>
            <Field label="Contact email" htmlFor="agent-email" error={errors.email ?? null}>
              <input id="agent-email" className={inputClass} value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="ops@atlas.example" />
            </Field>
            <Field label="Image" htmlFor="agent-image" error={errors.image ?? null} hint="https:// or ipfs://, optional.">
              <input id="agent-image" className={inputClass} value={form.image} onChange={(event) => update("image", event.target.value)} placeholder="ipfs://…" />
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-caption font-medium text-carbon">Agent type</span>
              <div className="flex flex-wrap gap-2">
                {AGENT_TYPES.map((type) => (
                  <PillToggle key={type} selected={form.agentType === type} onClick={() => update("agentType", type)}>
                    {type}
                  </PillToggle>
                ))}
              </div>
              <p className="text-caption text-graphite">LLM reasons, Task has a fixed set, Execution takes actions.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug (optional)" htmlFor="agent-slug" error={errors.slug ?? null} hint="A display alias, not an identifier.">
              <input id="agent-slug" className={inputClass} value={form.slug} onChange={(event) => update("slug", event.target.value)} placeholder="atlas" />
            </Field>
            <Field label="Version (optional)" htmlFor="agent-version" error={errors.version ?? null}>
              <input id="agent-version" className={inputClass} value={form.version} onChange={(event) => update("version", event.target.value)} placeholder="1.0.0" />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-body">
            <input type="checkbox" className="accent-lavender" checked={form.x402} onChange={(event) => update("x402", event.target.checked)} />
            Accepts x402 per-call payments
          </label>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-caption font-medium text-carbon">Capabilities</span>
              <GhostButton size="sm" onClick={() => setForm((current) => ({ ...current, capabilities: [...current.capabilities, { id: "", description: "", price: "" }] }))}>
                Add capability
              </GhostButton>
            </div>
            {form.capabilities.length === 0 ? <p className="text-caption text-graphite">What the agent can be hired for, each with an id a task names and a price per call in USDC. Optional; the card then carries no x-aip block.</p> : null}
            {form.capabilities.map((row, index) => (
              <div key={index} className="grid gap-3 rounded-2xl border border-fog p-4 sm:grid-cols-[1fr_1.6fr_auto_auto]">
                <input aria-label={`Capability ${index + 1} id`} className={`${inputClass} font-mono text-[13px]`} value={row.id} onChange={(event) => updateCapability(index, { id: event.target.value })} placeholder="text.summarize" />
                <input aria-label={`Capability ${index + 1} description`} className={inputClass} value={row.description} onChange={(event) => updateCapability(index, { description: event.target.value })} placeholder="Summarise documents into a brief." />
                <input aria-label={`Capability ${index + 1} price`} inputMode="decimal" className={`${inputClass} sm:w-28`} value={row.price} onChange={(event) => updateCapability(index, { price: event.target.value })} placeholder="0.05 USDC" />
                <GhostButton size="sm" onClick={() => setForm((current) => ({ ...current, capabilities: current.capabilities.filter((_, i) => i !== index) }))}>
                  Remove
                </GhostButton>
                {errors.capabilityRows?.[index] ? (
                  <p className="text-caption text-magenta sm:col-span-4" role="alert">
                    {errors.capabilityRows[index]}
                  </p>
                ) : null}
              </div>
            ))}
            {errors.capabilities ? <p className="text-caption text-magenta">{errors.capabilities}</p> : null}
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-caption font-medium text-carbon">Where the card lives</span>
            <div className="flex flex-wrap gap-2">
              <PillToggle selected={hosting === "data"} onClick={() => setHosting("data")}>
                On chain, as a data: URI
              </PillToggle>
              <PillToggle selected={hosting === "hosted"} onClick={() => setHosting("hosted")}>
                At a URL I host
              </PillToggle>
              <PillToggle selected={hosting === "none"} onClick={() => setHosting("none")}>
                No card yet
              </PillToggle>
            </div>
            {hosting === "data" ? (
              <p className="text-caption text-graphite">
                The card is stored in the registry itself, so nothing can go stale or offline; it costs gas by the byte{dataUri ? ` (${cardUriBytes(dataUri)} bytes)` : ""}. The way the smoke agents are registered.
              </p>
            ) : null}
            {hosting === "hosted" ? (
              <Field label="Agent URI" htmlFor="agent-uri" error={attempted && hostedKind !== "https" && hostedKind !== "ipfs" ? "An https:// URL or an ipfs:// CID that serves the card as JSON." : null} hint="Serve the card built on the right at this URI, or an ipfs:// CID of it. The resolver reads it on every resolution, so it can change without a trace on chain.">
                <input id="agent-uri" className={`${inputClass} font-mono text-[13px]`} value={hostedUri} onChange={(event) => setHostedUri(event.target.value)} placeholder="https://atlas.example/agent.json" />
              </Field>
            ) : null}
            {hosting === "none" ? <p className="text-caption text-graphite">Registers with an empty agent URI, which ERC-8004 allows: the agent exists and is owned, and its DID resolves with no services. A card can be set later by the owner.</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton size="sm" onClick={() => void register()} disabled={busy || !canSend || (attempted && !ready)}>
              Register agent
            </PrimaryButton>
            {reason ? <span className="text-caption text-ash">{reason}</span> : null}
          </div>
          {registered ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-fog bg-linen p-5">
              <p className="text-body font-medium text-carbon">Registered agent #{registered.agentId}</p>
              <p className="break-all font-mono text-[13px] text-carbon">{registered.did}</p>
              <p className="text-caption text-graphite">
                Transaction {registered.txHash ? <TxLink hash={registered.txHash} /> : null}. Bind this agent when submitting a job so the hook writes its reputation.
              </p>
            </div>
          ) : null}
        </div>
        <CardPreview built={built} />
      </div>
    </PanelCard>
  );
}

function CardPreview({ built }: { built: ReturnType<typeof cardFromForm> }) {
  const text = built.kind === "card" ? JSON.stringify(built.card, null, 2) : "";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-body font-medium text-carbon">Registration file</h3>
        <p className="mt-1 text-caption text-graphite">What the registry will point at, in the shape docs/agent-card/schema.json accepts. Copy it to host it yourself.</p>
      </div>
      {built.kind === "card" ? (
        <>
          <JsonEditor id="card-preview" value={text} onChange={() => undefined} error={null} minHeight={320} readOnly />
          <div>
            <GhostButton size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>
              Copy JSON
            </GhostButton>
          </div>
        </>
      ) : (
        <p className="rounded-2xl bg-mist p-5 text-caption text-graphite">Give the agent a name and a description to see its card.</p>
      )}
    </div>
  );
}

function YourAgents({ owner, onResolve }: { owner: Address; onResolve: (did: string) => void }) {
  const [list, setList] = useState<StoredAgent[]>([]);
  const [adding, setAdding] = useState("");
  const refresh = useCallback(() => setList(readStoredAgents(activeChain.id, owner)), [owner]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const parsedAdd = useMemo(() => parseAgentLookup(adding, { chainId: activeChain.id, identityRegistry: deployment.identityRegistry }), [adding]);
  const add = () => {
    if (parsedAdd.kind !== "did") return;
    const agentId = parsedAdd.did.split(":").pop() ?? "?";
    storeAgents(activeChain.id, owner, withStoredAgent(list, { did: parsedAdd.did, agentId, name: null, txHash: null, addedAt: Math.floor(Date.now() / 1000) }));
    setAdding("");
    refresh();
  };
  const forget = (did: string) => {
    storeAgents(activeChain.id, owner, list.filter((agent) => agent.did !== did));
    refresh();
  };
  return (
    <PanelCard title="Your agents" description={`The agents this browser knows for ${owner}: the ones registered here, and any you add by id. The chain does not list an owner's agents, so this list is kept locally.`}>
      {list.length === 0 ? <p className="text-caption text-graphite">None yet. Register one above, or add one you already own by its id.</p> : null}
      {list.length > 0 ? (
        <ul className="flex flex-col divide-y divide-fog">
          {list.map((agent) => (
            <li key={agent.did} className="flex flex-wrap items-center gap-3 py-3">
              <span className="w-24 text-body font-medium tabular-nums text-carbon">Agent #{agent.agentId}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-graphite" title={agent.did}>
                {agent.name ? `${agent.name} · ` : ""}
                {agent.did}
              </span>
              <span className="text-caption text-ash">{formatTimestamp(agent.addedAt)}</span>
              <GhostButton size="sm" onClick={() => onResolve(agent.did)}>
                Resolve
              </GhostButton>
              <GhostButton size="sm" onClick={() => forget(agent.did)}>
                Forget
              </GhostButton>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <div className="min-w-64 flex-1">
          <Field label="Add an agent you own" htmlFor="add-agent" error={adding.length > 0 && parsedAdd.kind === "invalid" ? parsedAdd.message : null}>
            <input id="add-agent" className={`${inputClass} font-mono text-[13px]`} value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Agent id or did:aip identifier" autoComplete="off" spellCheck={false} />
          </Field>
        </div>
        <GhostButton size="sm" type="submit" disabled={parsedAdd.kind !== "did"}>
          Add to the list
        </GhostButton>
      </form>
    </PanelCard>
  );
}
