# @squaresdk/agent

Write a Square agent in a few lines. An agent is a wallet that owns an
[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) id, a card that says what it does, an
A2A endpoint that takes tasks, and the escrow that pays for them. This package composes
the three underneath (`@squaresdk/a2a`, `@squaresdk/core`, `@squaresdk/x402`) so that the
agent's author writes the handler and nothing else.

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { createAgent } from "@squaresdk/agent";

const transport = http("https://rpc.testnet.arc.io");
const account = privateKeyToAccount(process.env.AGENT_KEY as `0x${string}`);
const agent = createAgent({
  name: "Atlas",
  description: "Summarises what it is given.",
  publicClient: createPublicClient({ chain: arcTestnet, transport }),
  walletClient: createWalletClient({ chain: arcTestnet, transport, account }),
  agentId: 7n,
  url: "https://atlas.example",
}).capability("text.summarize", {
  description: "The first three words.",
  price: "1.00",
  handler: async ({ input }) => input.split(/\s+/).slice(0, 3).join(" "),
});
await agent.listen(3000);
```

`agentId` is the ERC-8004 token the wallet owns (`square register` mints one, see
`packages/cli`); `url` is the public origin the card will name. That is the whole agent.

## On Stellar: `@squaresdk/agent/stellar`

Square is moving to Stellar, and the MVP agent lives at `@squaresdk/agent/stellar` beside
the EVM one above. It is an agent for hire that drives itself: it watches the kernel
(`square_job`) for jobs created for its key, works each once it is funded, submits the
output's hash, finalizes once the challenge window has passed (anyone may, and the
payee has the interest) and withdraws what it was paid. The job's `description` is the
work order: `translate: bonjour` picks the `translate` capability with `bonjour` as the
input, a bare description goes to the default (the only capability, or
`defaultCapability`). No card, DID or A2A endpoint yet; those come with the 8004
registries (phase 2).

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { deploymentFromJson, keypairSigner } from "@squaresdk/core/stellar";
import { createStellarAgent, fileStore } from "@squaresdk/agent/stellar";

const deployment = deploymentFromJson(JSON.parse(readFileSync("contracts/deployments/testnet.json", "utf8")));
const agent = createStellarAgent({
  name: "Atlas",
  description: "Summarises what it is given.",
  deployment,
  signer: keypairSigner(Keypair.fromSecret(process.env.AGENT_SECRET!), deployment.networkPassphrase),
  store: fileStore("./atlas.provider.json"), // the jobs it has seen, across restarts
}).capability("summarise", {
  description: "The first three words.",
  price: "2.5", // XLM: a job funded below it is left alone
  handler: async ({ input }) => input.split(/\s+/).slice(0, 3).join(" "),
});
await agent.listen(3000);
```

What it serves, for the hirer who paid and wants what is behind the hash:

| | |
|---|---|
| `GET /health` | name, account, the kernel, how many jobs it is tracking |
| `GET /capabilities` | what it does and asks for |
| `GET /jobs`, `GET /jobs/:id` | the jobs it has seen, as the loop keeps them (status, attempts, the transactions) |
| `GET /jobs/:id/deliverable` | the content whose SHA-256 `submit` put on chain, with the hash and the transaction |

The loop (`createProvider`) is the agent without the HTTP: `tick()` is one pass
(discover with `getEvents`, read each job, work, submit, finalize, withdraw) and
`start(intervalMs)` repeats it. Everything it knows is in `state`, kept by the store, so
a restart resumes: an output that never reached the chain is submitted rather than
computed again, a handler that failed is retried up to `maxAttempts` while the job is
still Funded, and what the client did (`reject`) or time did (expiry) is read off the
chain each tick. The kernel enforces no price, so the agent does: a job funded below
the capability's `price` (`minimumBudgetFor` on the loop) is left alone, before the
handler runs. The HTTP surface answers cross-origin reads (`cors`: every origin by
default, a list, or `false`), since the hirer's app fetches the deliverable from a
browser. `chainOf(client)` is the loop's view of `@squaresdk/core/stellar`'s
client; a test hands it a kernel in memory.

`npm test` runs the loop against that in-memory kernel (the lifecycle, the capability
choice, retries, resume from the state file, rejection and expiry) and the HTTP surface;
`STELLAR_LIVE=1 STELLAR_KERNEL=C… npm test` also hires the agent on testnet for real,
from an account Friendbot funds, and checks it delivers and is paid.

## What it serves

| | |
|---|---|
| `GET /.well-known/agent-registration.json` | The registration file, per [`docs/agent-card`](../../docs/agent-card/README.md): name, description, an `A2A` service at `/a2a`, a `DID` service naming the agent's `did:aip`, the on-chain registration, and every capability with its price under `x-aip`. `test/card.test.ts` holds it to the schema. |
| `POST /a2a` | `task/create` and `task/status`, JSON-RPC 2.0, from `@squaresdk/a2a`. |
| `POST /pay/<capability>` | The same handler, per call, paid with x402 for the capability's price. Only when `x402` is configured. |

## How a task is paid

The A2A tasks are the ones the escrow pays for, and the chain has a say at two moments
(square#79):

1. **Admission.** `task/create` names a `jobId`. Before the handler runs, the agent reads
   the job record and requires five things of it: `Funded`; for this wallet; still
   submittable, meaning at least the job's settlement window, `max(settlementHorizon,
   15 minutes)`, is left before `expiredAt` on the chain's clock (the latest block), since
   `submit` refuses anything shorter with `ExpiryTooShort` and the kernel funds such jobs
   regardless (square#334); funded with at least the capability's `price`; and payable,
   meaning that on a hook holding a compliance module the job's client has a policy on the
   registry, since the module refuses a release to a client without one for certain and
   the whole net goes back to that client (square#350). Anything
   else is refused with `-32004` and the reason (`job 12 is Open, not Funded`, `job 12 is
   funded for provider 0x…, not this agent`, `job 12 cannot be submitted: it expires at
   1791140894, 349128s from now, and submit needs 349200s before expiry (settlement horizon
   349200s, floor 900s)`, `job 12 is funded with 49999 but text.summarize costs 50000`,
   `job 12 cannot pay: the hook holds a compliance module and its client 0x… has no policy
   on the registry, so the release would be refused; the client has to commit a policy
   first`). No handler runs for a job that will not pay, and none for one that cannot be
   delivered.
2. **Delivery.** The handler's return value is the delivered content. Its
   `hashDeliverable` goes on chain with `submit(jobId, hash, agentId)`, which takes the job
   `Funded → Submitted` and binds it to the agent's ERC-8004 id (the hook checks the wallet
   owns it). `DELIVERED` carries the hash that the `JobSubmitted` event confirms and, as
   `reference`, the transaction. A submit that reverts fails the task with the chain's
   reason instead.

What happens next is the evaluator's, not the agent's: the keeper finalizes once the
challenge window closes, or the client disputes. `task/status` reports it as `job: {
status, name }`, read from the chain at every poll and stored nowhere, so `Completed` and
`Rejected` come from the record and cannot disagree with it. The provider then
`withdraw`s; `agent.client` is a `SquareClient` on the agent's wallet for exactly that.

The whole loop runs in `test/anvil.test.ts` against a local chain: create and fund a job,
`task/create`, `DELIVERED` by the submit with `AgentBound(jobId, 1)` in the receipt, the
crank's `finalize`, and a withdrawal of exactly the net payout.

The caller's side is `@squaresdk/a2a`'s `A2AClient`: fund a job for the agent's address
(`createJob`, the agent's `setBudget`, `fund`), then `task/create` with that `jobId`.

## Per-call work with x402

A capability with a `price` is also served at `POST /pay/<capability>` with a JSON body
`{ "input": "…" }` when the agent is given a facilitator:

```ts
createAgent({ ..., x402: { facilitator, payTo } })
```

`payTo` defaults to the agent's own wallet; the facilitator is `@squaresdk/x402`'s
`createSquareFacilitator` or a remote one. The handler gets the same call shape as over
A2A with `jobId` and `callerDid` empty: there is no job, the payment is the call itself.
`x402Support` on the card is `true` exactly when this is configured.

## Options

| | |
|---|---|
| `name`, `description` | The card's. |
| `walletClient`, `publicClient` | The provider. Its address is the one jobs must be funded for; its key signs `submit`. |
| `deployment` | Defaults to the chain the clients declare (Arc Testnet and the local anvil are known). |
| `agentId` | The ERC-8004 id this wallet owns. |
| `url` | Public origin, for the card. |
| `agentType`, `slug`, `agentVersion`, `image` | Card fields, optional. |
| `x402` | `{ facilitator, payTo? }`, optional. |
| `maxConcurrent`, `handlerTimeoutMs` | Passed to `A2AServer`. |

`capability(id, { description, price?, handler })` may be called any number of times after
`createAgent` and before `listen`. Ids are dotted lowercase (`text.summarize`); a capability
declared after the paid routes were first served is an error rather than a silent absence.

`agent.card()` returns the registration file; `agent.app` is the Hono app for a host that
already has a server; `agent.a2a` and `agent.settlement` are the pieces underneath.

## Tests

```bash
npm test              # card against the schema, admission and delivery against a stub chain, the HTTP surface
npm run test:anvil    # the lifecycle above against anvil with DeployLocal.s.sol on it
```
