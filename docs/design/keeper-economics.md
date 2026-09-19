# Keeper economics: why the crank is paid, and the smallest job that pays it

**Status:** decided in [#21][i21] for the EVM stack. Rewritten for Stellar in
[#6][i6], whose decision record is
[fees-and-ttl.md](../decisions/fees-and-ttl.md). The measurements behind it are
in [docs/deploy/resource-fees.md](../deploy/resource-fees.md). The Arc gas
figures this page used to carry are kept in
[docs/deploy/gas.md](../deploy/gas.md) as the record of that deployment. The
keeper change itself is [#37][i37].

[i6]: https://github.com/Square-StellarNetwork/square-stellar/issues/6
[i21]: https://github.com/Square-StellarNetwork/square/issues/21
[i27]: https://github.com/Square-StellarNetwork/square-stellar/issues/27
[i37]: https://github.com/Square-StellarNetwork/square-stellar/issues/37

## Why the crank is paid

A `finalize` costs XLM and returns nothing to reclaim, so an unpaid crank loses
money on every call and nobody runs one. That was true on Arc with USDC gas, and
it is true on Stellar with XLM resource fees. The optimistic model therefore
needs a fee, and the fee has to reach the account that paid for the
transaction.

What changed with the chain is the currency. The keeper earns USDC and spends
XLM, so every profitability decision converts one into the other at a real
price.

## Where the fee comes from

ERC-8183 pays `evaluatorFeeBP` of the budget to the job's evaluator at
`complete`, not to the caller. Our evaluator is the `keeper_evaluator`
contract, so the fee lands in its pull-payment balance on the kernel.
`finalize` and `finalize_decided` immediately forward that balance to the
keeper that submitted the transaction. The keeper leaves with the fee in the
same transaction, and nothing accumulates on the evaluator.

Two Stellar specifics:

- **The keeper needs a USDC trustline.** It receives USDC at a `G…` address, so
  without the trustline the forward, and with it the `finalize`, fails
  ([auth-and-token-flow.md](../decisions/auth-and-token-flow.md)). The keeper
  checks it at startup.
- **`finalize` needs no signature beyond the transaction's own.**
  `finalize(caller, job_id)` is authorized by `caller`, the fee's recipient.
  When the keeper is both `caller` and the transaction source, that
  authorization uses the source-account credentials and writes no nonce
  (row 11a of [resource-fees.md](../deploy/resource-fees.md)). Inside,
  `complete` is authorized by `keeper_evaluator` as the calling contract (row
  9).

The fee is a snapshot taken at `fund`, so an admin change never alters what a
job already in flight will pay.

## What one finalize costs

The cost is not a constant. For each candidate, the keeper simulates the exact
transaction it would send and adds up:

- `resourceFee`: `simulateTransaction(tx).minResourceFee`. This covers CPU,
  ledger reads and writes, transaction size, events, and rent for any TTL
  extension the contracts perform;
- `inclusionFee`: the bid the keeper sets. It is
  `getFeeStats().sorobanInclusionFee[INCLUSION_FEE_PERCENTILE]` (default
  `p90`), never below the ledger header's `baseFee`;
- `restoreFee`: `restorePreamble.minResourceFee + inclusionFee` when the
  simulation says an entry must be restored first, else 0.

`feeStroops = resourceFee + inclusionFee + restoreFee` is the most the
transactions can be charged. A Soroban transaction declares its resource fee in
the envelope, and it fails rather than paying more
([fees-and-ttl.md](../decisions/fees-and-ttl.md#the-fee-model)). So the keeper
knows its worst case before it sends, which it never did on Arc.

A simulation is a read-only RPC call. It costs no XLM, which is why the keeper
can afford one per candidate. It needs one because rent moves with the network's
state size and with each entry's remaining TTL.

The contracts of the B cluster are not deployed yet, so no real `finalize` has
been measured. The one settlement-shaped call measured on testnet, the probe's
`finalize → complete`, simulates at 13,200 stroops. A real `finalize` also runs
`complete`, the hook, the fee transfer and TTL extensions. With a compliance
module installed it adds the Groth16 pairing, 29,991,050 instructions and 40,108
stroops on its own. Its figure goes into
[resource-fees.md](../deploy/resource-fees.md) when it exists. The keeper does
not wait for it, because it simulates.

## Converting XLM to USDC

The rate comes from Reflector's SEP-40 oracle "External CEXs & DEXs". On
testnet it is `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`; on
mainnet, `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN`. The keeper
reads `lastprice(Other("XLM"))` and `lastprice(Other("USDC"))`, both against
USD with the feed's 14 decimals, by simulation. It checks the result against
the SDEX order book and uses the more expensive XLM price when the book is
tight enough to count. A price older than two oracle rounds is refused. Without
a usable price the keeper skips the job as `noPrice` rather than guess.
[fees-and-ttl.md](../decisions/fees-and-ttl.md#decision-2-where-the-rate-comes-from)
has the rules, the snapshot, and why a fixed `XLM_PER_USDC` was rejected.

No contract reads the oracle. The price decides only whether this keeper spends
its own XLM. It cannot move escrow, change a fee, or stop another keeper.

## The formula

All integer arithmetic. Budgets and fees are in USDC base units (7 decimals),
and costs in stroops until converted:

```
keeperFee   = floor(budget × evaluatorFeeBP / 10_000)
costUsdc    = ceil(feeStroops × xlmPrice × 10^usdcDecimals / (usdcPrice × 10^xlmDecimals))
profitable  ⇔ keeperFee × 10_000 ≥ costUsdc × (10_000 + MINIMUM_MARGIN_BPS)
```

`minimumProfitableBudget(evaluatorFeeBP, costUsdc, marginBps)` returns the
smallest budget for which `profitable` holds:

```
requiredFee = ceil(costUsdc × (10_000 + marginBps) / 10_000)
budget      = ceil(requiredFee × 10_000 / evaluatorFeeBP)
```

It returns `null` when `evaluatorFeeBP` is zero or negative, because no budget
makes a zero fee profitable. It returns `null` rather than a sentinel number
because the natural use of a floor is `budget >= floor`. The `-1n` this function
once returned made that comparison answer "every budget pays", the exact
opposite of what it meant.

`packages/core` does not export it. It is keeper-side arithmetic, not part of
the SDK surface, so a client that wants the floor before funding has to compute
it the same way or ask a keeper. The worked example, with the boundary cases a
unit test must pin, is in
[fees-and-ttl.md](../decisions/fees-and-ttl.md#worked-example-a-unit-test).
With the probe's 13,200-stroop `finalize`, a 100-stroop bid, the price of oracle
round 1789827000 and the default margin, the cost is 2,672 base units and the
smallest profitable budget at 0.5 % is 641,400 (0.06414 USDC). That figure moves
with every real measurement and every price round, which is why no break-even
table is published here.

## What `MINIMUM_MARGIN_BPS` means now

On Arc the margin covered gas-price spikes between the estimate and the receipt.
On Stellar the envelope caps the charge, so that risk is gone. The margin now
covers:

- **price movement** between the oracle round the keeper read (at most two
  rounds old) and the moment it converts the USDC it earned;
- **the venue gap** between the oracle's aggregate price and the price the
  keeper actually converts at.

The same number also decides whether the SDEX book is tight enough to be a
cross-check. It is the operator's policy, not a network fact. The default stays
2,000 (20 %), the value in `services/keeper/src/main.ts`.

## What goes away, and what replaces it

| Arc keeper | Stellar keeper ([#37][i37]) |
|---|---|
| `FINALIZE_GAS`, `FINALIZE_DECIDED_GAS`, `FINALIZE_GAS_SAMPLES` | removed: one simulation per candidate |
| `MODULELESS_*` and `GATED_*` constants in `services/keeper/src/gas.ts`, and reading the compliance module to pick them | removed: the simulation runs whatever the hook runs |
| `gasPriceWei × gas / 10^12` | `costUsdc` above, from stroops and the oracle |
| `square_finalize_gas_gap` and the `MAX_GAS_OVERSHOOT_PERCENT` alert | `square_resource_fee_gap` = declared − charged stroops per action. The charge cannot exceed the declaration, so there is no overshoot to alert on. The alert instead fires on a transaction that failed for want of resources (`*_RESOURCE_LIMIT_EXCEEDED`, `*_INSUFFICIENT_REFUNDABLE_FEE`), which means state changed between simulation and inclusion |
| `balance` check in wei of native USDC | spendable XLM (balance − minimum balance − selling liabilities) against `MIN_XLM_BALANCE`, with the `keeper.low_balance` warning ([below](#the-keepers-xlm)) |
| — | a USDC trustline check at startup |
| — | a `restore` action for archived entries, and the TTL sweep of contract code, instances and global configuration ([fees-and-ttl.md](../decisions/fees-and-ttl.md#instance-and-code)) |

## The "unprofitable" log

A job that fails the test is skipped, and it is journaled once per job, as
today: one `keeper_actions` row `{ action: "skipped", reason: "unprofitable" }`
and one `keeper.skipped` log line. The line's fields change:

| Field | Meaning |
|---|---|
| `jobId` | the job |
| `action` | `finalize` or `finalizeDecided` |
| `fee` | `keeperFee`, USDC |
| `resourceFee`, `inclusionFee`, `restoreFee` | the three parts of `feeStroops`, stroops |
| `costUsdc` | the converted cost, USDC |
| `requiredFee` | `ceil(costUsdc × (10_000 + marginBps) / 10_000)`, USDC |
| `minimumBudget` | `minimumProfitableBudget(…)` for this job's fee rate, USDC |
| `marginBps` | the margin applied |
| `price` | `{ xlm, usdc, decimals, timestamp, source, ledger }`, where `source` is `reflector`, `sdex` or `max` |

The old line reported the gas cost in a field named `gasUsed`. That name is not
carried over.

A `noPrice` skip is logged as `keeper.skipped` with `reason: "noPrice"` and the
reason the price was refused (stale, missing, or a book too wide). It is not
journaled per job, because it is not a property of the job.

A job below the break-even is not broken. A rational keeper simply never
finalizes it. The client can still `claim_refund` after expiry, the provider
can still list the receivable, and anyone can call `finalize` and pay the XLM
themselves.

## The keeper's XLM

The keeper spends XLM and earns USDC, so its XLM only goes down. `MIN_XLM_BALANCE`
(in stroops) sets the level at which `keeper.low_balance` warns and the
`balance` health check turns critical. If the operator does not set it, the
keeper derives it on every check, with no constant:

- `required = MIN_ACTIONS_FUNDED × maxRecentFee`. `maxRecentFee` is the largest
  `feeStroops` of its last tick, the TTL sweep included. `MIN_ACTIONS_FUNDED`
  defaults to 3, as today.
- `spendable = balance − (2 + subentries + sponsoring − sponsored) × baseReserve
  − selling liabilities`. The counters come from Horizon `accounts/{id}`, and
  `baseReserve` from the latest ledger header: 0.5 XLM on testnet on
  2026-09-19.

Turning earned USDC back into XLM is the operator's business and not automated
here.

## Why sponsorship is not needed for the keeper

The keeper is paid by the kernel and pays its own fees. Fee-bump sponsorship
through a relayer ([#27][i27]) is for agents and users who hold no XLM. For a
keeper it would move the same XLM to a sponsor with no benefit.

## Permissionless by construction

`finalize` and `finalize_decided` take no role. Anyone who watches the chain and
sees a closed window can call them and be paid. The reference keeper in
`services/keeper` is one implementation. Running a second one is a matter of
pointing it at the same contracts, and the fee goes to whichever lands first.
Extending a TTL or restoring an archived entry needs no role either
([fees-and-ttl.md](../decisions/fees-and-ttl.md#what-the-network-does)).
