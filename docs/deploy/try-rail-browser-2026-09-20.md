# The TRY rail from a browser, 2026-09-20

The whole rail driven by hand from the application, with a wallet extension signing,
against `tr-mock-anchor.fly.dev` on Stellar Testnet: lira in, a job funded with what the
anchor paid, an autonomous agent settling it, and lira back out. The companion to
[try-rail-testnet.md](./try-rail-testnet.md), which runs the same standards headlessly —
this one is what a person actually does, and it found four defects the headless run
could not.

|  |  |
|---|---|
| Network | `stellar:testnet` |
| Client wallet | `GDTAPT6EG36PECL2GEDSG7XYLGPESPCMBOFWTDQLYFSK7UPDTSONAA6S` |
| Agent | `GBPWEZTBLS65SLWIGDFZLHVUIGLSCGVTRQWKP2QGPNKMTSXV6UKJB3QA` (`square-hosted`, Claude) |
| Kernel | `CCOT26XWSUXQZUSEEVFCP5PMSF5AJEL2L764CSLQPEATVCKFRQLK2LH3` — the same Wasm, paid in USDC |
| Anchor | `tr-mock-anchor.fly.dev`, bank leg simulated |
| Asset | USDC `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet) |

## Lira in

| Step | Result | On chain |
|---|---|---|
| SEP-1 discovery | toml read, signing key and endpoints found | — |
| Trustline | `trust` on the asset's SAC, one signed invocation | `b10b4b3a…`, ledger 4771646 |
| SEP-10 sign-in | challenge signed by the wallet, token issued | — |
| SEP-38 quote | 48.785078 TRY per USDC, from a Reflector oracle | — |
| SEP-6 deposit | `sep_cxdaahi6o8ixi1ob7atc`, 250.00 TRY in, IBAN and reference given | — |
| The bank leg | simulated from the anchor's own page, 05:31:16Z | — |
| The anchor's payout | **5.0990227 USDC**, against a 1.25 TRY fee, at 06:13:47Z | `30ddc7c7…` |
| SEP-6 status | **`completed`** | — |

## A job funded with it, settled by the agent

Opened in the app against the USDC kernel and funded out of the balance the anchor had
just paid. Nothing below was driven by hand: the agent found the job on chain, ran the
model, submitted, waited out the window, finalized and withdrew.

| Step | Result | On chain |
|---|---|---|
| Agent's trustline | the agent opts in to be paid in USDC | `9694f85a…`, ledger 4772415 |
| `create_job` | `summarise: the quarterly report` | `0b75733f…`, ledger 4772434 |
| `set_budget` / `fund` | **1.00 USDC**, from what the anchor paid | — |
| `submit` | the model ran one turn, 125/146 tokens; the sha256 of its answer went on chain | `c22a55e9…`, ledger 4772606 |
| The window | 30 s, unchallenged | — |
| `finalize` | 0.975 USDC credited to the agent, 0.025 (2.5 %) to the owner | `16ff6719…`, ledger 4772614 |
| `withdraw_to` | the agent pulled its own payout | `2032f36a…`, ledger 4772615 |

The agent's balance afterwards is `0.9750000` USDC — the budget less the fee the contract
computed, to the stroop.

## Lira out

| Step | Result | On chain |
|---|---|---|
| SEP-6 withdraw | account, `memo_type: id`, memo `259357974650` | — |
| The payment | 1 USDC to the treasury carrying that memo | `6c1d7fe2…`, ledger 4771897 |
| SEP-6 status | **`completed`** — the asset taken, the TRY paid out | — |

## The anchor stopped paying for about seven hours

Between the deposit being opened and settling, the anchor sat in `pending_anchor` for
roughly forty minutes, and the chain showed why: its treasury's **last outgoing payment
before ours was 2026-09-19T23:10:02Z**. Everything in between was incoming — withdrawals,
which it kept settling throughout, as the leg above shows. Its on-ramp worker was down;
its off-ramp was not.

Nothing it reported said so. Its `/health` gave a treasury of 998,671.8777246 USDC with
`low_balance: false` on the right issuer; the transaction carried no `pending_reason`,
though the anchor's own guide says a stalled on-ramp shows `treasury_low` or `retrying: …`
and that both clear by themselves; and `updated_at` did not move from the second it
entered `pending_anchor`, against a documented on-ramp cadence of three seconds. It
resumed on its own at 06:13:47Z and paid the full amount it had computed.

It is worth recording because it is the failure a production integration has to survive:
the customer's side had completed correctly and the money was owed, which is exactly
what `pending_anchor` is for. The deposit settled without anyone resending anything.

The 20 USDC used for the withdrawal leg came from Circle's testnet faucet (`3b9b6470…`),
which is what made that leg testable while the anchor was still down. The job above was
funded from the anchor's own payout.

## What the run found in this codebase

Four defects, each fixed with a test that fails without its fix. None could be seen from
the headless script, because none exist outside a browser or outside a real anchor.

1. **SEP-6 could not run in a browser at all.** `fetch` is a method of the window and
   WebIDL refuses a call whose receiver is anything else. The client held the global on a
   field and called `this.doFetch(...)`, so every SEP-6 request raised *Failed to execute
   'fetch' on 'Window': Illegal invocation*. SEP-1, SEP-10 and SEP-38 call it with no
   receiver and were unaffected, which is why the page signed in and quoted before it
   stopped.

2. **A withdrawal was sent without the anchor's memo.** The leg reused the Stellar Asset
   Contract `transfer` that funding a job makes, and a contract call cannot carry a memo —
   a memo is a field of the transaction. The first attempt (`967c1f7b…`) reached the
   treasury with `memo_type: none` while the withdrawal sat waiting for a payment it could
   recognise. Against a production anchor that money is gone. The leg is now a classic
   payment carrying the memo, which is what SEP-6 intends and what anchors watch for.

3. **A wallet failure read as "Unknown error".** An extension rejects with its own object,
   not an `Error`, so the message never reached the screen while the real cause — an
   extension the page could no longer reach — sat in the console.

4. **Two things the screen said wrong.** The deposit's own result was rendered after an
   unrelated panel, a screen below the button that started it, so pressing Deposit looked
   like it did nothing. And one status table served both legs, so a completed *withdrawal*
   announced that the asset was in the wallet — the reverse of what had happened to the
   money.
