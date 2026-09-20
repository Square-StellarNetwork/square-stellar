# The core integration is Stellar Wallets Kit, with CCTP as the second rail; Blend v2 is refused

**Status:** decided in [#57][i57]. Binds [#39][i39] (the app's signing path), [#31][i31]
(USDC from another chain) and [#58][i58] (the fiat rail).

[i57]: https://github.com/Square-StellarNetwork/square-stellar/issues/57
[i39]: https://github.com/Square-StellarNetwork/square-stellar/issues/39
[i31]: https://github.com/Square-StellarNetwork/square-stellar/issues/31
[i58]: https://github.com/Square-StellarNetwork/square-stellar/issues/58

## The decision

**Stellar Wallets Kit** is the integration the product is built on. It is the only way
any party acts on an escrow: every one of the six steps in the lifecycle is a signature
from the client's or the agent's own wallet, and in the app the kit is where every one of
those signatures comes from. Remove it and there is no client side — no job is opened,
funded, delivered or withdrawn.

**CCTP** is the second integration, and the one that carries the money rail once the
kernel is paid in USDC ([#31][i31]). It is live on Stellar Testnet and was read back from
the chain for this decision; what it is not yet is load-bearing, because the MVP kernel
is paid in native XLM.

**Blend v2 is refused**, against the team's steer of 2026-09-19, on two grounds that are
each sufficient and both sourced below: it is off the official SCF Integration List, and
the only Blend pool on Stellar Testnet values its collateral through a price feed whose
own published interface carries `set_price` — the prices are written by an administrator,
not observed.

## What load-bearing has to mean

The handbook asks that "the integration is load-bearing, part of what the product does",
and the judging criterion that it be "fundamental to the product rather than an add-on".
Square's product is six steps, and the test applied below is simply: take the protocol
away, and which of them stops working?

```text
open ──▶ price ──▶ fund ──▶ deliver ──▶ window ──▶ withdraw
```

Five of the six are a transaction signed by a human's wallet: `create_job` and `fund` by
the client, `set_budget` and `submit` by the agent, `withdraw_to` by whoever is owed.
Only `finalize` is permissionless, and even that is a signed transaction from someone.

## Stellar Wallets Kit — chosen

*On the list: Wallet Integration → Wallet Connection Layers.*

`@creit.tech/stellar-wallets-kit` 2.6.0 is the app's whole authorization layer. It
discovers the installed wallets, owns the selection modal, remembers the chosen wallet
by its product id, and hands back the two SEP-43 calls the SDK's `Signer` is made of:
`signTransaction` for an envelope and `signAuthEntry` for a Soroban authorization entry
the signing account is not the source of. The client's `SquareClient` takes that signer
and nothing else; `packages/core/src/stellar/signer.ts` is written around exactly those
two calls, so the kit is not adapted to the product — the product's signer type is the
shape the kit already has.

Take it away and the browser has no way to reach Freighter, xBull, Albedo, Lobstr or
Hana, which is to say no way to open, fund, deliver or settle a job. That is the whole
client side of a two-sided product.

What is honest about its limits: today's flow signs through `signTransaction` alone,
because an account that submits its own transaction authorizes through the envelope
signature; `signAuthEntry` is the path for a signer that is not the submitter, which is
fee sponsorship ([#27][i27]). And the agent runtime does not use the kit at all — it
holds its own key through `keypairSigner`, because a server process has no browser
extension to ask. The kit is load-bearing for the client side, not for both.

[i27]: https://github.com/Square-StellarNetwork/square-stellar/issues/27

**Where it lands.** [#39][i39], on `feat/app-stellar-mvp`. On `main` the app is still the
EVM one, with `wagmi` and `viem` in its manifest; the kit arrives when that branch does.

## CCTP — second, and load-bearing when the token is USDC

*On the list: DeFi → Cross-Chain & Interoperability.*

Read from Stellar Testnet on 2026-09-20 through `stellar contract invoke --send=no`:

| | |
|---|---|
| `MessageTransmitter` `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` | `get_local_domain()` → **27**, `get_version()` → **1**; the interface carries `send_message` and `receive_message` |
| `TokenMessengerMinter` `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` | live |
| `CctpForwarder` `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` | live; a transfer into Stellar names it as both `mintRecipient` and `destinationCaller` |

The place it would sit is exact: an institution holding USDC on Ethereum, Base or
Arbitrum burns it there and mints it on Stellar, and `fund` takes the minted balance
from there — the same shape as the Arc version already built in
[`docs/design/cctp-funding.md`](../design/cctp-funding.md), with the domain changed from
26 to 27 and the EVM `receiveMessage` replaced by the forwarder.

It is not claimed as the core integration today, and the reason is not effort: the MVP
kernel is deployed against native XLM, so nothing a cross-chain transfer delivers is
what a job is funded with. Calling it core while the product takes XLM would be the
"add-on" the criterion exists to catch. It becomes core in the same change that makes
the kernel take USDC, which is what [#58][i58] already proposes for the anchor rail.

## Blend v2 — refused

*The official SCF Integration List, read on 2026-09-20, shows Blend struck through with
the note "**Blend temporarily removed from list**". [#57][i57] records that the
handbook's own eligible-partners list still carries "DeFi - Lending: Blend v2"; that
discrepancy is what [#66][i66] is for.*

[i66]: https://github.com/Square-StellarNetwork/square-stellar/issues/66

The idea was good and specific: escrow sits idle for the whole challenge window, and a
lending pool would pay yield on it. Two facts stop it.

**The list.** An integration has to be on the SCF Integration List, or on the handbook's
list, for the requirement to be met. Blend is on one and removed from the other, and a
submission that rests on the removed entry rests on something the awarding body has
already withdrawn.

**The only pool on testnet is priced by a mock, and the contract says so itself.** Blend's
`TestnetV2` pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`, read on
2026-09-20:

```text
get_config       {"bstop_rate":1000000,"max_positions":8,"min_collateral":"0",
                  "oracle":"CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI","status":0}
get_reserve_list ["CDLZFC3S…" (XLM), "CAZAQB3D…" (wETH), "CAP5AMC2…" (wBTC),
                  "CAQCFVLO…"]
```

Blend's own `blend-utils/testnet.contracts.json` names that oracle **`oraclemock`**, but
the name is not the evidence — its published interface is. Alongside the SEP-40 reads
(`base`, `assets`, `decimals`, `lastprice`) it carries three writes that no price feed
has:

```rust
fn set_price(env: Env, prices: Vec<i128>, timestamp: u64);
fn set_price_stable(env: Env, prices: Vec<i128>);
fn set_data(…);   // the admin, base, decimals, asset list and resolution
```

The prices are whatever an administrator last wrote. It answers `decimals` → 7, `base` →
`Other("USD")`, and a `last_timestamp` that keeps moving, so it looks alive; it is a
mock with a cron behind it.

The pool's USDC reserve is `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`,
which `blend-utils` names `USDC` and which is Blend's own test issue — not Circle's
testnet USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
([stellar-target.md](./stellar-target.md)). Escrow held by Square would be valued at a
price an admin typed and denominated in a token nobody redeems. The project takes no mock
anywhere; a yield figure computed from one would be the worst possible place to break
that.

**Our own pool is not a way out.** `poolFactoryV2`
`CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6` would deploy a pool with
Circle's USDC and a real oracle, and three costs follow it.

The backstop `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` takes its
deposits in one token, and it answers `backstop_token()` →
`CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM`, the BLND/USDC Comet LP that
`blend-utils` calls `comet`. Backing a new pool means acquiring that LP first.

The oracle has to be adapted, not merely pointed at. The Blend pool's oracle registers
its assets in the address form — `assets()` answers
`[{"Stellar":"CAQCFVLO…"},{"Stellar":"CDLZFC3S…"},{"Stellar":"CAZAQB3D…"},{"Stellar":"CAP5AMC2…"}]`
— while Reflector's live CEX/DEX feed
`CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` publishes in the symbol form:
read on 2026-09-20 it answers `base` → `Other("USD")`, `decimals` → 14, and
`lastprice(Other("XLM"))` → `19465561906722` at `1789869600`, a real price of
0.1946556… USD. Both are SEP-40, and the `Asset` enum has both `Stellar(Address)` and
`Other(Symbol)` arms, so nothing is broken — but a contract mapping each reserve's
address to a symbol has to be written, deployed and then trusted with the valuation of
other people's escrow.

And at the end of all three the protocol is still the one removed from the list.

Escrow yield stays a good idea for a product that is not two days from a submission. It
is recorded here, refused here, and not lost.

## The rest, briefly

| | Where it would sit | Why not now |
|---|---|---|
| **DeFindex** (list: Yield Aggregators) | the same escrow-yield idea, through a vault instead of a pool | Same shape as Blend without the list problem, and worth a look if escrow yield is ever taken up. It carries the same structural cost: yield on escrowed funds changes who owns the interest during a dispute, and that is a change to the settlement rules ([#9][i9]), not an integration. |
| **Soroswap, Aquarius, Stellar Broker** (list: DeFi) | converting whatever an anchor delivers into the token the kernel takes | Nothing to convert until the anchor rail exists and the kernel takes a token other than what it delivers ([#58][i58]). |
| **Trustless Work** (list: DeFi) | escrow itself | It would replace Square's kernel with someone else's escrow. The kernel is the product — the window, the pull-payment ledger, the permissionless finalize. Adopting it is not integrating a protocol into Square; it is deleting Square. Refused. |

[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9

## What was read, and when

Everything above that is a number or an address was read on **2026-09-20** from Stellar
Testnet through `https://soroban-testnet.stellar.org`, or from the protocol's own
published deployment record, not from a summary:

- the Blend pool's `get_config` and `get_reserve_list`, its oracle's published
  interface and its `assets`, `base`, `decimals` and `last_timestamp`, and the
  backstop's `backstop_token`, all by simulation;
- `blend-utils/testnet.contracts.json` for the names behind those ids;
- CCTP's `get_local_domain` and `get_version`, and the three contracts' interfaces;
- Reflector's `base`, `decimals` and `lastprice`;
- the SCF Integration List page, for who is on it.

No value in this decision comes from a mock, a fixture or a page that could not be
checked against the chain.
