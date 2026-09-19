<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/public/logo-inverse.svg">
    <img src="app/public/logo.svg" alt="Square" width="96" height="96">
  </picture>
</p>

<h1 align="center">Square</h1>

<p align="center"><strong>Compliance-gated settlement for autonomous agent work, on <a href="https://stellar.org">Stellar</a>.</strong></p>

An institution commits a private spending mandate on-chain: the chain holds a commitment
to it, and the institution's own tools prove each release in their own process, so the
policy behind the commitment never leaves them
([prover-trust-boundary.md](docs/decisions/prover-trust-boundary.md)). The app's job page
is the exception: it sends the policy to the prover it is configured with, whose operator
sees it. Identified agents execute against the mandate. The hook that releases escrow
carries a compliance slot: with a module installed, a release must first prove, in zero
knowledge, that it fits the mandate. Escrow protects the provider against everything
except that mandate: a payment the mandate forbids returns to the client with the reason
on chain, and a proof that is merely missing holds the escrow until the institution does
its duty ([proof-required.md](docs/decisions/proof-required.md)). The receivable created
during the challenge window is discountable, and sells only to a buyer the institution's
policy approved.

The proof is a Groth16 proof over BN254, and Stellar verifies it natively: Soroban's
BN254 host functions ([CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md),
Protocol 25, and [CAP-0080](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0080.md),
Protocol 26) carry the pairing check, so the circuit, its phase-1 powers of tau and the
Poseidon policy commitment are the same ones the earlier Arc and Solana versions of this
work used. Only the verifier is written for Soroban.

---

## Status

**Pre-alpha on Stellar Testnet (Protocol 27).** The settlement layer and the Groth16
verifier are deployed on the testnet; the verifier sits at an address the ceremony will
replace, and the testnet itself is reset a few times a year, so every address below is
reproduced by script rather than remembered. Nothing carries an assurance claim.

`***` marks a value that is written when the deployment it comes from lands
([#45](https://github.com/Square-StellarNetwork/square-stellar/issues/45)); the migration
is tracked in [#48](https://github.com/Square-StellarNetwork/square-stellar/issues/48).

| Layer | State |
|---|---|
| Identity: `did:aip` v3 (`stellar` namespace), agent card, CLI, Universal Resolver driver | resolves 8004 registries on Stellar Testnet ([docs/smoke](docs/smoke/)) |
| Settlement: `square_job`, `keeper_evaluator`, `arbitration`, `claim_market`, `square_hook` | Soroban contracts on Stellar Testnet, covered by the Rust suite including a kernel-solvency invariant; the five settlement paths run on the testnet with real USDC and the 8004 registries (`***`, the dated record) |
| Services: indexer, keeper, sanctions screener, x402 gateway, data layer, observability | implemented and tested against the local stack (`stellar/quickstart`); the screener also against its sanctions source |
| Compliance: circuit, prover, Groth16 verifier, `compliance_module`, the institution's side | circuit and prover unchanged from the Arc version; verifier built on the BN254 host functions; the module exists and the shared hook's slot is `***`; the institution's side, `@squaresdk/policy`, the `square policy` commands, `square_hire`, the hosted agent and the app, commits policies and keeps proofs bound to jobs |
| Website (`site/`) | live at [square-protocol.vercel.app](https://square-protocol.vercel.app), adapted from an MIT template with Square's own copy and surfaces, every button leads to the app |
| App: reference web application (`app/`) | a static Next.js export that reads the deployed contracts through `@squaresdk/core` and drives every lifecycle action from a connected Stellar wallet; no mocked data ([app/README.md](app/README.md)) |

> The ZK trusted setup is a **development setup** in phase 2: the phase 1 is real, the
> Perpetual Powers of Tau contribution 80 adopted and verified by hash
> ([docs/ceremony/phase1-ptau.md](docs/ceremony/phase1-ptau.md)), and the phase 2 is a
> single contribution with no beacon. Either half on its own lets that machine forge a
> proof for any statement. [#51](https://github.com/Square-StellarNetwork/square-stellar/issues/51)
> is the public phase-2 ceremony on the Stellar version of the circuit and it has not been
> held. Until it completes, nothing here carries an assurance claim of any kind. Evidence
> and wording: [docs/disclosure/](docs/disclosure/); read either phase out of any key with
> [`circuits/scripts/inspect-zkey-setup.mjs`](circuits/scripts/inspect-zkey-setup.mjs).

## Design

Three layers. Stellar supplies the bottom one.

| Layer | What we build | Stellar primitive it sits on |
|---|---|---|
| Identity | `did:aip` v3 resolver, agent card schema | the 8004 Identity Registry on Soroban (a per-network singleton) |
| Settlement | `square_job` (escrow kernel, pull-payment ledger), `keeper_evaluator` (optimistic challenge window, paid permissionless finalize), `arbitration` (bonded disputes, M-of-N), `claim_market` (receivable discounting) | Soroban contracts, the USDC Stellar Asset Contract (SEP-41), the authorization framework in place of `approve` |
| Compliance | `square_hook` routes the payout, runs the Groth16 check and writes reputation; `compliance_module` plugs into its slot; `groth16_verifier` does the pairing | BN254 host functions (CAP-0074, CAP-0080), the 8004 Reputation and Validation registries |

The composition point is the hook: the proof gates **release**, not deposit, and it is
bound to the address the kernel will actually pay, which is the receivable's buyer when
the receivable was sold. Who can become that buyer is gated too: the poster's policy
publishes the root of a salted list of approved buyers, and `buy` checks the purchaser
against it without the list reaching the chain
([buyer-eligibility.md](docs/decisions/buyer-eligibility.md)). Reputation stays with the
agent that did the work.

Two things are different on Soroban and shape every contract. The host **prohibits
re-entry**, so the kernel hands the hook everything it needs as arguments and the hook
never reads the kernel back; and there is no per-call gas limit, only one budget per
transaction, so a hook that fails is tolerated but a hook that exhausts the budget is
not. Both are decided in
[#3](https://github.com/Square-StellarNetwork/square-stellar/issues/3).

Design notes, each the record of a decision:

- [Storage layout and event schema](docs/design/storage-and-events.md)
- [SquareHook: one hook, selector routing, shared optParams](docs/design/square-hook.md)
- [Data layer: one Postgres, chain is the source of truth](docs/design/data-layer.md)
- [Keeper economics: why the crank is paid](docs/design/keeper-economics.md)
- [Travel Rule: the commitment goes on chain, the personal data never does](docs/design/travel-rule.md)
- [The daily ceiling is public, the policy behind it is not](docs/decisions/public-daily-ceiling.md)
- [The proof is made where the policy lives](docs/decisions/prover-trust-boundary.md)
- [A missing proof holds the escrow; only the mandate refunds](docs/decisions/proof-required.md)
- [A hook informs, it never vetoes, on the way out of escrow](docs/decisions/hook-failure-modes.md)
- [A lapsed dispute returns the bond](docs/decisions/lapsed-bond.md)
- [From the mandate to the payment: the product in one flow](docs/design/mandate-to-payment.md)

Decisions the move to Stellar adds, each an issue until its record is written:
Groth16 on the BN254 host functions ([#2](https://github.com/Square-StellarNetwork/square-stellar/issues/2)),
the call graph under the re-entry prohibition ([#3](https://github.com/Square-StellarNetwork/square-stellar/issues/3)),
32-byte addresses as field elements ([#4](https://github.com/Square-StellarNetwork/square-stellar/issues/4)),
authorization and the token flow ([#5](https://github.com/Square-StellarNetwork/square-stellar/issues/5)),
resource fees, keeper economics and ledger-entry TTLs ([#6](https://github.com/Square-StellarNetwork/square-stellar/issues/6)),
upgradeability and governance ([#49](https://github.com/Square-StellarNetwork/square-stellar/issues/49)).

## Provenance

Distilled from three prior projects and one earlier chain. Selected components only; no
on-chain layer is ported as code.

| Source | What carries over |
|---|---|
| aperture | Circom circuit, Poseidon policy commitment, prover service |
| aip-beta | `did:aip` spec and resolver, A2A task protocol, MCP bridge, agent SDK |
| covenant | Escrow state machine (as specification), x402 verifier, chain-agnostic hardening |
| square on Arc | The contract design, the hook, the compliance module and every decision record; the EVM code is rewritten for Soroban |

## Running it

Everything, on a local Stellar network, from one command:

```bash
make up
```

That brings up a local network (`stellar/quickstart`: core, RPC, Horizon, Friendbot),
deploys the contracts to it, migrates Postgres, builds the circuit artifacts, and starts
the prover, the indexer, the screener, the keeper and the application, returning only
once all five report healthy. Docker, git and make are the whole prerequisite.
[docs/deploy/local-stack.md](docs/deploy/local-stack.md) has the ports, the measured
start-up time and how to point the same stack at Stellar Testnet.

## Layout

```
contracts/   Rust/Soroban workspace: square_job, keeper_evaluator, arbitration, claim_market,
             square_hook, policy_registry, compliance_module, groth16_verifier,
             screening_registry, deploy scripts and the test suite
circuits/    Circom payment-compliance circuit + ceremony scripts
packages/    did-resolver, cli, did-aip-driver, core (SDK, generated contract bindings),
             data (Postgres access layer + migrations), hardening (SSRF, idempotency, rate
             limit, RPC failover, signed actions), observability (logs, metrics, health,
             alerts), x402 (payment gateway), aa (fee sponsorship and smart accounts),
             a2a (task protocol), agent (an agent in a few lines: card, A2A tasks paid
             through escrow, x402), mcp (agents calling MCP tools; Square as an MCP server
             for Claude Desktop), hosted (an institution's agent run from a configuration),
             policy (the institution's side of the compliance gate)
services/    prover, indexer, keeper, screener (sanctions screening)
app/         Next.js reference application (static export, Stellar Wallets Kit, Open Runde design system)
site/        The website at https://square-protocol.vercel.app: what Square is, and the door to the app
docs/        Specifications, design notes, measurements, disclosure
```

The packages publish to npm under `@squaresdk`, all thirteen at one version from a
`v<version>` tag ([docs/decisions/distribution-channel.md](docs/decisions/distribution-channel.md));
the first tag has not been cut, so today each is built from this clone, and every pull
request packs the thirteen and installs the tarballs into an empty project so that the
day it is cut nothing is missing from them.

Every pull request runs the contract, circuit, prover, package and application suites.
The circuit and prover jobs build the artifacts their tests refuse to run without,
because a suite that quietly skips itself is the failure this is set up to catch.
[docs/ci.md](docs/ci.md) lists the checks, what each proves, and which are required to
merge.

## Network

| | |
|---|---|
| Network | Stellar Testnet, Protocol 27 ([docs/decisions/stellar-target.md](docs/decisions/stellar-target.md)) |
| Network passphrase | `Test SDF Network ; September 2015` |
| CAIP-2 | `stellar:testnet` |
| RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Explorer | `https://stellar.expert/explorer/testnet` |
| Fee token | XLM (resource fees and inclusion fee) |
| Payment token | USDC, issued natively by Circle: issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, Stellar Asset Contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (7 decimals) |
| USDC from elsewhere | Circle's CCTP V2, Stellar domain `27`: burned on Ethereum, Base or Arbitrum Sepolia, attested by Circle, minted here through Circle's `CctpForwarder`, then funded into a job ([docs/design/cctp-funding.md](docs/design/cctp-funding.md)) |
| 8004 registries | Identity `***`, Reputation `***`, Validation `***` |

Escrow and payment paths use the USDC Stellar Asset Contract: amounts are 7-decimal
base units, funding is a `transfer` the client authorizes for the kernel's call, and no
`approve` step exists. Fees are paid in XLM by whoever submits the transaction, which is
what lets a keeper or a relayer submit an agent's signed authorization on its behalf.

### Deployments

| Contract | Address | Status |
|---|---|---|
| `groth16_verifier` | `***` | **temporary** — keyed to the development proving key, replaced by the ceremony's ([#51](https://github.com/Square-StellarNetwork/square-stellar/issues/51)) |

`circuits/scripts/build.mjs` draws fresh phase-2 entropy on every build, so any verifier
deployed today is already wrong for tomorrow's build. Every deployment before #51 has a
lifetime of one `npm run build`. The ceremony fixes one key, and that is the one worth
an address — on mainnet, because the testnet is reset a few times a year and its
addresses are reproduced by script rather than kept
([#54](https://github.com/Square-StellarNetwork/square-stellar/issues/54)).

A proof from the prover service verifies against Stellar's own BN254 host functions,
with one read-only `simulateTransaction` against the testnet and nothing sent:

```bash
node contracts/script/verify-on-stellar.mjs
```

The measured cost of one verification — CPU instructions, ledger bytes read, and the
resource fee in XLM — is `***`; the table it belongs to, `docs/deploy/resource-fees.md`,
lands with [#6](https://github.com/Square-StellarNetwork/square-stellar/issues/6).
The verifier is written here under Apache-2.0 from the pairing equation, not generated by
snarkjs ([docs/decisions/groth16-verifier-license.md](docs/decisions/groth16-verifier-license.md)).

### Square contracts

Deployed with `contracts/script/deploy-testnet.sh` from `***`, with fixed salts so that a
testnet reset reproduces the same addresses. Testnet parameters: challenge window 120 s,
dispute window 300 s, finalize grace 600 s (so `settlement_horizon()` reads 1020 s),
evaluator fee 0.5 %, platform fee 1 %, bond 10 % with a 1 USDC floor, three arbiters with
threshold 2. The owner is `***`. The checklist a redeploy walks is
[docs/deploy/README.md](docs/deploy/README.md).

| Contract | Address |
|---|---|
| `square_job` | `***` |
| `keeper_evaluator` | `***` |
| `arbitration` | `***` |
| `claim_market` | `***` |
| `square_hook` | `***` |
| `policy_registry` | `***` |
| `compliance_module` | `***` |
| `screening_registry` | `***` |

`@squaresdk/core` carries these addresses (`deployments["stellar:testnet"]`), and
`contracts/deployments/testnet.json` is the record they are copied from; a test asserts
the two agree. The five settlement paths were run against them with real USDC and a
provider registered as 8004 agent `***`; every transaction hash and the measured resource
fee are in `***`, the dated record of that run.

## License

Apache-2.0. See [LICENSE](LICENSE). [NOTICE](NOTICE) carries the SIL OFL 1.1 notice of
the Open Runde typeface the app and the site are set in.

Stellar is a trademark of the Stellar Development Foundation. Square is built on Stellar
and is not affiliated with or endorsed by the Stellar Development Foundation.
