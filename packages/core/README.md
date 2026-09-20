# @squaresdk/core

The integration library for Square settlement on [Arc](https://arc.io): one typed client
over the five contracts, the ABIs they compile to, the spec hash a job commits to, and
the decoding of what the contracts emit. Every other package and service in this
repository settles through it; nothing here talks to anything but the chain.

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { connectSquareClient, hashDeliverable } from "@squaresdk/core";

const transport = http("https://rpc.testnet.arc.io");
const square = await connectSquareClient({
  publicClient: createPublicClient({ chain: arcTestnet, transport }),
  walletClient: createWalletClient({ chain: arcTestnet, transport, account: privateKeyToAccount(key) }),
});

const { jobId } = await square.createJob({
  provider,
  expiredAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400),
  spec: { task: "translate", words: 1200, deadline: "2026-09-30T00:00:00Z" },
});
await square.submit({ jobId, deliverable: hashDeliverable(text), did: "did:aip:eip155:5042002:0x8004…:2" });
```

The addresses come from the deployment record for the chain the clients declare; pass
`deployment` to override, or when the clients carry no chain.

## The Stellar client: `@squaresdk/core/stellar`

Square is moving to Stellar ([docs/decisions/stellar-target.md](../../docs/decisions/stellar-target.md)).
The Stellar client lives at `@squaresdk/core/stellar` beside the EVM client above while
the Soroban contracts are written; the EVM client leaves with them. Today it is the MVP
(milestone "MVP — testnet"): the kernel's methods over the generated bindings in
`src/bindings/square_job`, and everything a call needs that is not a contract's
interface: the network, the deployment record, the signer, the simulate → sign → send →
poll pipeline, error decoding, event decoding, amounts, and the payment token, native XLM
on testnet.

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { connectSquareClient, deploymentFromJson, kernelEvent, keypairSigner, usdcUnits } from "@squaresdk/core/stellar";

const deployment = deploymentFromJson(record); // contracts/deployments/testnet.json, or deploymentFor("stellar:testnet") once it is compiled in
const client = await connectSquareClient({ deployment, signer: keypairSigner(Keypair.fromSecret(clientSecret), deployment.networkPassphrase) });
const agent = await connectSquareClient({ deployment, signer: keypairSigner(Keypair.fromSecret(agentSecret), deployment.networkPassphrase) });

// The client opens the job, the agent prices it, the client escrows the price: one signature, no approve.
const { result: jobId } = await client.createJob({ provider: agent.account, expiredAt: now + 3600n, description: "summarise the quarterly report" });
await agent.setBudget(jobId, usdcUnits("2.5")); // base units at 7 decimals: 25000000n stroops
await client.fund(jobId, usdcUnits("2.5"));     // refused if the budget changed meanwhile (BudgetMismatch)

// The agent delivers; the challenge window runs; then anyone finalizes and the agent pulls its payout.
const submitted = await agent.submit(jobId, deliverableText); // records sha256(deliverableText)
const { finalizeAfter } = kernelEvent(submitted.events, "submitted")!;
// … after finalizeAfter (ledger seconds), unless the client called reject(jobId, reason) inside the window:
const finalized = await agent.finalize(jobId);
const { payout, fee } = kernelEvent(finalized.events, "finalized")!;
await agent.withdraw(payout);
```

**The kernel's methods.** `createJob`, `setBudget`, `fund`, `submit`, `finalize`,
`reject`, `claimRefund`, `withdrawTo` / `withdraw` write; `getJob`, `withdrawable`,
`jobCounter`, `kernelConfig`, `kernelOwner`, `kernelTotals` read. The signer is the acting
address (`client`, `provider` or `account` in the contract's signature); `finalize` and
`claimRefund` name nobody and anyone may crank them. Arguments are encoded and return
values decoded through the bindings' own spec (`squareJobSpec`), so the SDK holds no copy
of the contract's interface. `getJob` answers a `SquareJob`: the record with camel-cased
fields, bigints for `u64`s, and `finalizeAfter` (= `submittedAt + challengeWindow`) worked
out. `submit` takes the deliverable's content and records its SHA-256, or a 32-byte hash
as given (`deliverableHash`). The kernel itself is
[contracts/contracts/square_job/README.md](../../contracts/contracts/square_job/README.md):
the state machine, who signs what, the error codes, the events.

**Every write is simulated first, and a refusal is the contract's own error, by name.**
`read` simulates and answers the return value; `write` simulates, signs, sends and polls
until the transaction is in a ledger, then answers `{ hash, ledger, result, events,
feeCharged }`. A simulation the host refuses throws before anything is signed:
`SquareContractError` when a contract raised a `#[contracterror]`, with `code`,
`errorName` from that contract's error table (the kernel's `SQUARE_JOB_ERRORS` comes from
its bindings; the token's is the SAC's), `raisedBy` (the contract in the call tree that
raised it, read off the diagnostic events, so the SAC's refusal beneath `fund` is the
token's) and the message the contract logged; `SimulationFailedError` for anything else
the host refused. A transaction that fails in its ledger throws `TransactionFailedError`;
one the network refuses at submission `TransactionSendError`; one not seen within
`timeoutInSeconds` `TransactionPendingError`, with the hash to check.

**`connectSquareClient` asks the endpoint which network it is.** `getNetwork` once,
compared with the deployment record's passphrase; `DeploymentNetworkMismatchError` with
`source: "endpoint"` otherwise, before anything is read. `createSquareClient` does the
same lazily. A signer bound to another network is refused at construction
(`source: "declared"`).

**A signer is bound to one network.** `keypairSigner(keypair, passphrase)` refuses to
sign a transaction for another passphrase and an authorization entry whose preimage
carries another network id (`SignerNetworkMismatchError`). Any SEP-43 wallet object with
an `address` is a `Signer` too, which is how the app (#39) and smart accounts (#27) plug
in; `signAuthEntry` is only exercised when the signer is not the account submitting the
transaction.

**No approve; the token, and trustlines.** `fund` moves the token inside the client's
own authorization ([auth-and-token-flow.md](../../docs/decisions/auth-and-token-flow.md)),
so there is no allowance step anywhere here. The deployment's `token` is what the kernel
was deployed with: native XLM on testnet, which every account holds and needs no
trustline for; or an issued asset such as USDC, which a `G…` account cannot hold or
receive without one. `trustline(address)` reads that off the ledger (`native`,
`contract`, `missing`, or `open` with the balance), `assertReceivable` throws
`TrustlineMissingError`, `trustToken()` opens the signer's through the SAC's own `trust`
(CAP-0073), one signed invocation, and answers null when none is needed. `tokenBalance`
is an account's XLM balance, or its trustline's balance for an issued asset, and the
SAC's entry for a contract.

**Amounts are base units at 7 decimals, as bigints.** `usdcUnits("1.50")` is
`15000000n` (the same 7 decimals for XLM: stroops), `formatUsdc` / `formatXlm` print
them, `assertTokenAmount` refuses what a contract refuses at its boundary (negative, or
above the `u64` a record holds). `addressField(address)` is `f`, the field element the
circuit and the compliance module compute for an address
([address-field-mapping.md](../../docs/decisions/address-field-mapping.md)).

**The deployment record.** `deploymentFromJson` reads `contracts/deployments/<network>.json`
as the deploy scripts (#19) write it. The MVP record is the kernel and its token:

```json
{
  "network": "stellar:testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "ledger": 4760307,
  "contracts": { "square_job": "C…" },
  "token": { "code": "XLM", "contractId": "C…" },
  "wasm": { "square_job": "<sha256 of the deployed Wasm>" }
}
```

`contracts` names the crates and only `square_job` must be there; the other eight are
named as they are deployed. `token` is `{ "code": "XLM" }` for the native asset or a
code with its `issuer`; `contractId` may be given and must then be the SAC that asset
derives to on that network. `wasm` pins each deployed crate's Wasm by sha256, which
`npm run check:deployed-wasm` compares with the contract instance on chain and the
working tree's build (`docs/deploy/stellar-mvp.md`). `usdc { issuer, contractId }` and `registries { identity,
reputation, validation }` are named when the network has them, checked the same way, and
on testnet USDC's issuer must be Circle's. `deploymentFor("stellar:testnet")` answers the
copy compiled in here once the testnet record exists; a test asserts the copy and the
file agree. `networkFor("stellar:testnet" | "stellar:local")`, or by passphrase, carries
the rest: RPC, Horizon, Friendbot, the explorer, and USDC.

**Events.** `decodeSquareEvents(source, deployment)` is the deployment's contract events
in a `getTransaction` response, a `getEvents` page or raw `xdr.ContractEvent`s, decoded to
native values with the contract's crate name (the payment token's as `token`), placed by
ledger and event id (from `getEvents`, the indexer's cursor) or by position in the
transaction. `kernelEvents(events)` types the kernel's among them (`job_created`,
`budget_set`, `funded`, `submitted`, `finalized`, `rejected`, `refunded`, `withdrawn`,
`skimmed`, `ownership_offered`, `ownership_transferred`) and `kernelEvent(events, name)`
picks one; a kernel event whose shape is not the contract's is `MalformedEventError`,
since that means the deployment is not the contract the bindings came from.

**The fiat rail: an anchor (SEP-1, SEP-10, SEP-6, SEP-38).** `discoverAnchor(homeDomain)`
reads the anchor's `stellar.toml`; `authenticateWithAnchor(anchor, signer)` signs in with
the wallet — the SEP-10 challenge is checked (the anchor's signing key, this account,
this home domain, this network) and signed with the same `signTransaction` every kernel
write uses — and answers a session with the anchor's token; `new Sep6Client(session)`
asks for a `deposit` (fiat in, the asset lands in the wallet) or a `withdraw` (the asset
out, fiat to a bank account), reads a `transaction` and `follow`s it to a final status;
`quotePrice` is the SEP-38 rate. The anchor's request for customer fields (SEP-12) comes
back as `AnchorNeedsMoreError` with the fields it named. On testnet the TRY⇄USDC anchor is
`tr-mock-anchor.fly.dev`, a sandbox that simulates the bank and pays real testnet USDC
(`test/stellar/anchor-live.test.ts` runs the rail against it); the wallet needs its USDC
trustline first (`trustToken` on a deployment whose token is USDC).

```ts
const anchor = await discoverAnchor("tr-mock-anchor.fly.dev", { expectedNetwork: deployment.networkPassphrase });
const session = await authenticateWithAnchor(anchor, signer);
const sep6 = new Sep6Client(session);
const deposit = await sep6.deposit({ assetCode: "USDC", type: "bank_account", amount: "1000" }); // deposit.how: the IBAN and the reference
const done = await sep6.follow(deposit.id!, { onStatus: (t) => console.log(t.status) });   // … completed, USDC in the wallet
```

`npm test` covers this against real testnet answers captured as fixtures
(`test/stellar/fixtures/`, `capture.mjs` refreshes them) and against return values
encoded with the bindings' spec; `STELLAR_LIVE=1 npm test` also runs
`test/stellar/live.test.ts` against testnet itself: the endpoint check, reads of the USDC
SAC, a decoded refusal, and a real `trust` from an account Friendbot funds for the run.
With `STELLAR_KERNEL=C…` naming a kernel deployed with native XLM and a short window, it
runs the whole MVP lifecycle there, from two Friendbot accounts: create, price, fund,
submit, a refused early finalize, the window, finalize, withdraw.

## What is worth knowing

**`connectSquareClient` asks the endpoint which chain it is; `createSquareClient` only
asks the clients.** The constructor compares the deployment to the chain the viem
clients *declare*, and both sides of that come from the caller, so it cannot catch an
RPC URL that points at another chain. `connectSquareClient` runs `eth_chainId` once and
refuses on a mismatch before anything is read; `createSquareClient` does the same lazily,
before the first read or write. Either way the refusal is a `DeploymentChainMismatchError`
whose `source` says which comparison failed: `"endpoint"` for the RPC's answer,
`"declared"` for the clients' own chain. A transport failure on the check is not cached;
the next call retries it.

**A revert names the contract that raised it, whichever one you called.** `SquareJob`
re-raises the hook's revert data as its own, and the hook's errors are the ones a `submit`
caller can trigger. viem decodes a revert by looking its selector up in the ABI it was
handed for the call, so every read and every simulation here carries `SQUARE_ERRORS`, the
custom errors of all Square ABIs, through `withSquareErrors`. It adds **error entries
only**, so no function name from one contract can shadow another's, and the ABI a
simulation approved is the one the write goes out with. `AgentNotOwnedByProvider(7, you)`
comes back by name; before, it was `Unable to decode signature 0x2e0a79a4`.

**`submit` takes a DID.** `submit({ jobId, deliverable, did })` binds the job to the
ERC-8004 agent the `did:aip` identifier names, through the hook. The DID has to be scoped
to the chain and Identity Registry this client settles on (`DidScopeMismatchError`
otherwise), and if `agentId` is passed as well it has to agree with it
(`AgentIdMismatchError`). `agentId` alone works too. With neither, no agent is bound.

**`agentOf(jobId)` answers `null` for "no agent bound", and `0n` for agent 0.** Agent
id 0 is a real agent (on Arc's registry it is the first registration), so the hook's own
`agentOf` reverts with `NoAgentBound` when nothing is bound and `boundAgentOf` answers
both questions; this reads the latter. On a hook deployed before that change only the
old `agentOf` exists and answers 0 for both, and this reads its 0 as `null`, which is
what it meant there and is wrong only for agent 0.

**Every write is simulated first, then checked once mined.** A revert in simulation
throws with the decoded error and nothing is sent. A transaction that passes simulation
and reverts once mined throws `TransactionRevertedError` with the hash and receipt. A
successful write returns `{ hash, receipt, events }`, the events decoded across all five
contracts (`decodeReceipt` does the same for a receipt you already hold).

**A write needs a wallet; a read does not.** Construct with `publicClient` alone for a
read-only client; a write on it throws `WalletRequiredError`.

**`fund` screens the parties first, on a hook that screens.** A hook with a screening
registry installed (`screening()` names it; [sanctions-screening.md](../../docs/decisions/sanctions-screening.md))
refuses to fund a client or a provider without a fresh, clean record. So `fund` reads
both records before it sends (`screeningOf(address)` answers `cleared`, `sanctioned`,
`unscreened` or `no-screening`), asks the client's `screener` for whoever lacks one,
reads again, and throws `PartyNotClearedError` naming the party and why when one is
still not cleared. Nothing is sent then: the job stays `Open` with its budget set, the
client keeps its USDC, and the same `fund` completes it once the party is cleared. Pass
`screener: createScreenerClient({ url })` to `createSquareClient` to have it ask the
screener service (services/screener); with no screener, an unscreened party is refused
before sending rather than reverting on chain. A hook that predates screening is read as
one that screens nobody, once.

## The spec hash

A job's description is the commitment to what was ordered. `createJob({ spec })` writes
`specDescription(spec)`, which is `spec:` followed by `specHash(spec)`: `keccak256` of the
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form of the spec, so any
party holding the same JSON recomputes the same hash whatever key order or whitespace
it kept. `specMatchesDescription(spec, description)` is the check; `specHashFromDescription`
pulls the hash out, `undefined` for a description that carries none.

The canonical text has to be JSON a parser can read back to a value that canonicalises
to the same text, or the commitment is to something no one else can reproduce. So a spec
is checked for being JSON data at every depth before it is hashed, and anything else is a
`SpecError` that names the path: `null`, booleans, strings, finite numbers, arrays of
those and plain objects of those are JSON data; a bigint, a function, a symbol, `NaN`,
`Infinity`, an `undefined` inside an array, a cycle, a `Date`, a `Map` or a class instance
are not. A key whose value is `undefined` is dropped, as `JSON.stringify` drops it. Pass
amounts as strings or numbers, dates as ISO strings.

## Deployments

`deploymentFor(chainId)` returns the addresses compiled into this package for a chain it
knows (Arc Testnet `5042002`, and `31337` for a local anvil once `DeployLocal.s.sol` has
run); `deploymentFromJson` reads the same shape from a file, which is how the services
take `SQUARE_DEPLOYMENT_FILE`. The compiled copy and `contracts/deployments/5042002.json`
have to move together on a redeploy, and a test here asserts that they agree; see
[`docs/deploy/README.md`](../../docs/deploy/README.md) for the full list of places an
address lives. `networkFor(chainId)` carries what is not an address: the RPC endpoint,
the explorer, the native currency (USDC with 18 decimals on the native interface, 6 on
the ERC-20 one).

## Also exported

- `decodeSquareLogs(logs, deployment)` and `eventsNamed(events, name)`: the receipt's logs
  as typed events across the five contracts.
- `finalizeReason`, `resolutionHash`, `hashDeliverable`, `Outcome`: the hashes the
  contracts expect as `reason` and `evidence`, built the way `KeeperEvaluator` and
  `Arbitration` build them.
- `encodeSubmitOptParams`, `encodeCompleteOptParams` and their decoders: the `optParams`
  bytes of `submit` (agent id and validation request) and `complete` (provider share and
  compliance proof).
- `agentFromDid`: a `did:aip` v2 identifier as `{ chainId, registry, agentId }`.
- `createScreenerClient({ url })`: `POST /screen` at the screener service, sixteen
  addresses to a request, as a `Screener`; `ScreenerError` when it refuses or cannot be
  reached. Any `{ screen(addresses) }` that puts records on chain serves as one.
- USDC into Arc from Ethereum, Base or Arbitrum Sepolia over Circle's CCTP V2 (square#32):
  `depositForBurn` on the source chain, `waitForAttestation` at Circle's service,
  `receiveMessage` on Arc, `bridgeUsdcToArc` for the three in a row, `reattest` for an
  attestation that lapsed, `decodeCctpMessage` for the bytes, `cctpFees` and `maxFeeFor`
  for the fee; `CCTP_TESTNET_DOMAINS` and `CCTP_V2_TESTNET` are the domains and the shared
  contract addresses, read back from the chains
  ([docs/design/cctp-funding.md](../../docs/design/cctp-funding.md)).
- The ABIs, from `@squaresdk/core/abi` as well, generated from the compiled contracts and
  checked in CI to still match them.

## Tests

```bash
npm test              # unit, no network
npm run test:anvil    # the lifecycle against a local anvil with DeployLocal.s.sol on it
npm run lifecycle     # the settlement paths end to end, written up as a report; LIFECYCLE_FINALIZER=keeper on a chain a keeper watches
npm run bridge        # USDC from another testnet into Arc over CCTP V2, and into a job; needs two funded keys
```

`test/fork.test.ts` runs the same lifecycle against a fork of Arc Testnet with the real
ERC-8004 registries when `ARC_FORK_RPC_URL` is set. The lifecycle's report carries
square#31's eight steps, from the mandate to the payment, as a table of their own, read
off the receivable path; with `LIFECYCLE_FINALIZER=keeper` the runner leaves every
settlement to the keeper watching the chain and records the keeper's transaction
([docs/design/mandate-to-payment.md](../../docs/design/mandate-to-payment.md)). `test/screening.test.ts` is the
funding screening against a table of registry answers; the anvil suite installs the
stack's registry on the hook for one case and takes it off again. `test/cctp.fork.test.ts`
burns through Circle's real `TokenMessengerV2` on a fork of Ethereum Sepolia when
`CCTP_SEPOLIA_FORK_RPC_URL` points at one (`anvil --fork-url <sepolia rpc>`), and reads a
message Arc already minted from the live chain. `npm run generate:abi` regenerates the
ABIs from `contracts/out`; CI fails if the checked-in copy differs.
