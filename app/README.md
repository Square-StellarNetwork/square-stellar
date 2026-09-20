<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-inverse.svg">
    <img src="public/logo.svg" alt="Square" width="72" height="72">
  </picture>
</p>

# Square app

The reference web application for Square, the settlement protocol for autonomous agent work, on Stellar. It is a static Next.js export that talks to the deployed Soroban contracts through `@squaresdk/core` and to the connected wallet through [Stellar Wallets Kit](https://stellarwalletskit.dev). Nothing on screen is mocked: every number comes from the chain, or is shown as an honest empty state.

## What it does

The testnet MVP is one flow — connect a wallet, open a job, fund it, deliver, finalize or dispute, withdraw — and every screen in it reads the chain directly.

| Route | Purpose |
|---|---|
| `/` | Landing page with live numbers (jobs opened, escrow held, settled, last activity), the settlement layers, the lifecycle and a live network strip. |
| `/dashboard` | Metric tiles, the escrow flow, pipeline and settlement charts, a jobs table with phase filters, a search by id or address and a button that reads 50 older jobs at a time, and, with a wallet connected, the wallet's XLM balance and its withdrawable credit on `square_job` with a Withdraw button, plus an inbox of the jobs waiting on that wallet: deliverable to submit before the expiry less the job's settlement horizon, escrow to fund, budget to agree, challenge window open, ready to finalize, refund available. |
| `/job?id=N` | The full job record, the settlement clock built from its timestamps, the parties, how the budget divides, and every lifecycle action the connected wallet may take: set provider, set budget, fund, submit, dispute, finalize, reject, claim refund, withdraw. A deliverable or dispute note is hashed in the browser with SHA-256, so only the digest reaches the chain. |
| `/new` | Create a job: provider, expiry (at least twice the settlement horizon away, so the job is still submittable after it is funded), a description of at most 256 bytes, and an optional budget set right after creation. The evaluator and hook come from the deployment record. |
| `/agents`, `/policy`, `/network` | Phase 2. Each page says what it will hold and which issue brings it, rather than showing figures the MVP cannot read. |

Static export means there are no dynamic route segments, so the job page reads its id from the query string. All data is fetched on the client with React Query and refreshed every ten seconds.

### Where the job list comes from

There is no indexer in the MVP. The dashboard reads the kernel's own `job_created` events through Soroban RPC's `getEvents` over the last 17 000 ledgers, then reads each job's record from the contract; the total comes from `job_counter`. Soroban RPC keeps only a recent window of events, which is why the page says how many jobs it scanned next to every count it derives. The indexer arrives with [#36](https://github.com/Square-StellarNetwork/square-stellar/issues/36).

## Charts

Every chart is computed from the job records the page already reads; nothing is sampled, estimated or mocked.

| Where | Chart | Data | Library |
|---|---|---|---|
| Dashboard | Escrow flow: funded per hour or day as thin rounded bars, running totals funded and submitted as smooth lines | `funded_at`, `submitted_at` and `budget` of the most recent job records | Recharts |
| Dashboard | Pipeline by phase: budget held per phase with the job count on top | phase derived from status, challenge window and dispute flag | Recharts |
| Dashboard | Settled on recent jobs: paid to payees, platform fees, evaluator fees, refunded to clients | terminal job records, their snapshotted fees and the provider share the settlement decided | Recharts |
| Job | Settlement clock: the job's phases laid out in time with the live one outlined and a marker for now | record timestamps and `challenge_end` | SVG |
| Job | Payout split: net payout, client share after a decision, platform and evaluator fees | the fee basis points the record carries, `net_payout`, `provider_bps` | SVG |

Paid to payees is the provider share of the net that each completed job settled at, so a job decided at a split contributes only that share; the rest of its net is credited back to the client by `square_job`'s `complete` and is counted as refunded, next to the budgets of rejected jobs. The bucket of the escrow flow is an hour while the records span three days or less and a day after that. The settlement clock scales to the job's own activity; an expiry far beyond it is written under the clock instead of flattening it. Charts are drawn by [Recharts](https://recharts.org) (MIT) on SVG, which is also what the hand-drawn clock and segment bars use, so the whole page shares one rendering model.

## Amounts and the payment token

Stellar amounts carry seven decimals, so one whole token is `10_000_000` in the base units every contract call takes. What the token is called on screen is read from the kernel: `payment_token` is a contract id, and the app names it XLM when it is the native asset's Stellar Asset Contract, USDC when it is the deployment's, and by its id otherwise. The testnet MVP funds in XLM.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `testnet` | `testnet` for Stellar Testnet or `local` for a quickstart container. Anything else falls back to testnet. |
| `NEXT_PUBLIC_RPC_URL` | network default | Overrides the Soroban RPC endpoint (`https://soroban-testnet.stellar.org` or `http://localhost:8000/rpc`). |
| `NEXT_PUBLIC_HORIZON_URL` | network default | Overrides Horizon, which the app reads native balances from (`https://horizon-testnet.stellar.org` or `http://localhost:8000`). |
| `NEXT_PUBLIC_DEPLOYMENT` | unset | A deployment record as JSON, for a stack that is not the one `@squaresdk/core` carries for this network. When neither is present the app still runs: the network strip says there is no deployment and the pages that need contract ids say so instead of inventing them. |

The variables are inlined at build time. Copy `.env.example` to `.env.local` and rebuild after changing them.

## Running

`@squaresdk/core` is a `file:` dependency and is consumed from its `dist/`, which is not committed, so on a clean checkout it has to be built before the app is installed. From the repository root:

```console
$ (cd packages/core && npm install --install-links && npm run build)
$ cd app
$ npm install --install-links
$ npm run typecheck
$ npm test
$ npm run build
```

`--install-links` copies the workspace package into `node_modules` instead of symlinking it, so the app and the SDK share one copy of `@stellar/stellar-sdk`; two copies would give the app a second `xdr` module and every `ScVal` built by one would fail an `instanceof` check in the other.

`npm test` runs the unit tests with Vitest: the phase derivation, the formatters, the chart aggregation, the action gates, the wallet inbox, the live statistics, the address reader and the error descriptions are pure modules under `src/lib` and are tested without a chain.

`npm run build` writes the static site to `out/`. Serve it with any static file server, for example:

```console
$ python3 -m http.server 4310 --directory out
```

`npm run dev` starts the Next.js dev server for local work.

### Against Stellar Testnet

The default build targets Stellar Testnet with the contract ids `@squaresdk/core` carries for it. Connect Freighter, xBull, Albedo, Lobstr or Hana; the wallet chooses the network, so when it is on another one the wallet button says so and asks for the switch to be made there. A testnet account is funded by Friendbot, and both fees and escrow are paid in XLM.

### Against a local quickstart

Run the Stellar quickstart, deploy the contracts, and point the build at it:

```console
$ docker run --rm -p 8000:8000 stellar/quickstart:latest --local --enable-soroban-rpc
$ NEXT_PUBLIC_NETWORK=local npm run build
```

A local network has no explorer, so addresses and transaction hashes render as plain text instead of links.

## Layout

```
src/app/            App Router pages, layout, providers, global styles
src/components/     Design system components (PrimaryButton, GhostButton, Chip, NavPill, TabBar,
                    MetricCard, PanelCard, DataTable, StatusPill, AddressLink, Amount, TxToast,
                    EmptyState, WalletButton) and the page views under views/
src/lib/stellar.ts  The network, its endpoints, the deployment record and the explorer links
src/lib/wallet.ts   The Stellar Wallets Kit singleton, the remembered wallet and the signer
src/lib/scval.ts    Building and reading the ScVals every contract call takes and returns
src/lib/contracts.ts Every read and write this app makes on the Square contracts
src/lib/square.ts   The React Query hooks over those calls, and the chain clock
src/lib/actions.ts  The gates the kernel enforces, shared by the job page, the inbox and the form
src/lib/clock.ts    The offset between the chain and the browser clock, and the skew notice threshold
src/lib/address.ts  Reading an address input: an account, a contract, or malformed
src/lib/format.ts   Amount, strkey, timestamp and duration formatting
src/lib/tx.tsx      Transaction runner, toast state and what each chain error means in words
```

## Design tokens

The page is a white engineering blueprint: a bright white canvas, a restrained grayscale, one lavender accent for primary actions and iris for the wallet button. Tokens live in `src/app/globals.css` as Tailwind v4 `@theme` values:

| Token | Value | Use |
|---|---|---|
| `carbon` | `#181925` | Primary text, never pure black |
| `graphite` / `ash` | `#666666` / `#999999` | Secondary and muted text |
| `fog` | `#e8e8e8` | Every 1px border and gridline |
| `linen` / `mist` | `#fafafa` / `#f5f5f5` | Alternating bands; inputs and disabled states |
| `lavender` | `#918df6` | Primary action button, active tab underline |
| `iris` | `#9580ff` | Wallet connect button |
| `mint` on `mint-wash` | `#33c758` / `#def6e4` | Completed or positive |
| `amber` | `#ffa600` | In window or pending |
| `sky` | `#2c78fc` | Open or funded |
| `magenta` | `#d6409f` | Disputes and rejected |

Type scale: caption 12, body 16, subheading 18, heading-sm 24, heading 36, heading-lg 48, display 60 with tight negative tracking. Radii: 8px inputs, 16px cards, 24px table containers, 9999px on every button, chip and pill. Amounts use tabular numbers.

Status pill labels are set in carbon on a tinted wash with a coloured dot, because the tone colours themselves do not reach a 4.5:1 contrast ratio as text on the wash.

## Wallets

The wallet button offers the SEP-43 wallets Stellar Wallets Kit carries a module for — Freighter, xBull, Albedo, Lobstr and Hana — through the kit's own modal, and the chosen wallet is remembered by its product id, so a person stays connected with that wallet on every page and after a reload. Signing goes through two calls and no more: `signTransaction` for a transaction, `signAuthEntry` for an authorization entry the account is not the source of. The network is the wallet's to choose; when it is on a different one, a notice names both and the connection is not used for writes.

## Clock

Every time gate on screen comes from the chain, not from the browser. `useNetwork` reads the latest ledger and its close time next to the job counter and keeps the offset between that time and `Date.now()` at the moment of the read; `useNow` still ticks once a second off the local clock and adds that offset, so countdowns move smoothly while the second they name is the ledger's. The dispute and finalize buttons, the refund gate, the dashboard inbox and the settlement clock all derive from it.

The size of the windows is the reason. A keeper's challenge window is counted in minutes, not days, so a browser a couple of minutes fast would judge the window closed the instant the provider submitted and would never draw the dispute button at all, on a chain that was still accepting the dispute. The opposite direction is harmless: the SDK simulates every write before sending it, so an action offered too early fails in simulation without spending a fee.

When the two clocks differ by 30 seconds or more, a line above every page names the difference and its direction. The threshold sits well above the few seconds of ledger close time and round trip that separate an accurate machine from the last ledger, and well below the window it exists to protect.

## Errors

A write is simulated before it is sent, and a refusal carries the contract's own error: the client decodes it from the simulation's diagnostics against the error table of whichever contract in the call tree raised it, so the page can say `WrongStatus` from `square_job` rather than `Error(Contract, #2)`. Archived state, missing signatures, a missing trustline, a transaction that landed and applied nothing, and one still pending each get the sentence that says what to do about it.

## Brand assets

`public/brand/` holds the marks of the two other parties on screen. The Stellar mark labels references to the network and the footer lockup; the USDC mark labels amounts on a stack whose kernel holds USDC. Both are used unmodified; their provenance is in `public/brand/README.md`.

## Font

The interface is set in Open Runde, loaded from `public/fonts` at weights 400, 500, 600 and 700. Open Runde is Copyright 2023 Laurids Kern (https://github.com/lauridskern/open-runde), a rounded derivative of Inter, and is distributed under the SIL Open Font License 1.1. The licence text carrying both copyright lines is in `public/fonts/LICENSE.txt`, and the root [NOTICE](../NOTICE) lists the font with the rest of what the tree redistributes.
