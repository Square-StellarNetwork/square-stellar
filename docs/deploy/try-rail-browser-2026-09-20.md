# The TRY rail from a browser, 2026-09-20

The rail driven by hand from the application at `/deposit`, with a wallet
extension signing, against `tr-mock-anchor.fly.dev` on Stellar Testnet. The
companion to [try-rail-testnet.md](./try-rail-testnet.md), which runs the same
standards headlessly: this one is what a person actually does, and it found
four things the headless run could not.

|  |  |
|---|---|
| Network | `stellar:testnet` |
| Wallet | `GDTAPT6EG36PECL2GEDSG7XYLGPESPCMBOFWTDQLYFSK7UPDTSONAA6S` |
| Anchor | `tr-mock-anchor.fly.dev`, bank leg simulated |
| Asset | USDC `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet) |
| Anchor treasury | `GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6` |

## What ran

| Step | Result | On chain |
|---|---|---|
| SEP-1 discovery | toml read, signing key and endpoints found | — |
| Trustline | `trust` on the asset's SAC, one signed invocation | `b10b4b3a…`, ledger 4771646 |
| SEP-10 sign-in | challenge signed by the wallet, token issued | — |
| SEP-38 quote | 48.785078 TRY per USDC, from a Reflector oracle | — |
| SEP-6 deposit | `sep_cxdaahi6o8ixi1ob7atc`, 250.00 TRY in, IBAN and reference given | — |
| Bank leg | simulated from the anchor's own page at 05:31:16Z | — |
| Anchor's payout | **never made** — see below | — |
| SEP-6 withdraw | account, `memo_type: id`, memo `259357974650` | — |
| The payment out | 1 USDC to the treasury, carrying that memo | `6c1d7fe2…`, ledger 4771897 |
| Anchor's settlement | `completed` — the asset taken, the TRY paid out | — |

**The withdrawal leg is proven end to end.** The deposit leg is proven as far
as the anchor's own door: it signed the customer in, quoted, opened the
deposit, took the simulated transfer and computed what it owed — 5.0990227
USDC against a 1.25 TRY fee, to the right account — and then did not pay.

## Why the deposit did not complete

Not for any reason on this side, and not for any reason the anchor reports:

- Its `/health` says the treasury holds 998,671.8777246 USDC and
  `low_balance: false`, on the same issuer the transaction names.
- The transaction carries no `pending_reason`. The anchor's own guide says a
  stalled on-ramp shows `treasury_low` or `retrying: …`, and both clear by
  themselves. Neither is set.
- `updated_at` has not moved since the second it entered `pending_anchor`,
  though the guide puts the on-ramp settlement cadence at three seconds.
- The destination account holds the trustline, so it is a plain payment — not
  even the claimable-balance path the anchor falls back to.

What the chain shows is an anchor that stopped paying at a particular moment.
Of its last 200 payments 116 are outgoing, and **the most recent of those is
2026-09-19T23:10:02Z**. Everything after it is incoming — withdrawals, which
it still settles, as this run's own withdrawal proves. Its on-ramp worker has
been down for about six hours; its off-ramp is healthy.

The USDC used for the withdrawal came from Circle's testnet faucet
(`3b9b6470…`, 20 USDC) because the anchor could not deliver any.

## What the run found in this codebase

Four defects, each fixed on the branch this document arrived on. None of them
could be seen from the headless script, because none of them exist outside a
browser or outside a real anchor.

1. **SEP-6 could not run in a browser at all.** `fetch` is a method of the
   window and WebIDL refuses a call whose receiver is anything else. The
   client held the global on a field and called `this.doFetch(...)`, so every
   SEP-6 request raised *Failed to execute 'fetch' on 'Window': Illegal
   invocation*. SEP-1, SEP-10 and SEP-38 call it with no receiver and were
   unaffected, which is why the page signed in and quoted before it stopped.

2. **A withdrawal was sent without the anchor's memo.** The leg reused the
   Stellar Asset Contract `transfer` that funding a job makes, and a contract
   call cannot carry a memo — a memo is a field of the transaction. The first
   attempt (`967c1f7b…`) reached the treasury with `memo_type: none` while the
   withdrawal sat waiting for a payment it could recognise. Against a
   production anchor that money is simply gone. The leg is now a classic
   payment carrying the memo, which is what SEP-6 intends and what anchors
   watch for.

3. **A wallet failure read as "Unknown error".** An extension rejects with its
   own object, not an `Error`, so the message never reached the screen while
   the real cause — an extension the page could no longer reach — sat in the
   console.

4. **The deposit's own result was rendered below an unrelated panel**, a
   screen away from the button that started it, so pressing Deposit looked
   like it did nothing; and one status table served both legs, so a completed
   withdrawal announced that the asset was in the wallet — the reverse of what
   had happened to the money.
