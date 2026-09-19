# Fees, keeper profitability and ledger-entry TTL on Stellar

**Status:** decided in [#6][i6]. Binds:

- the storage schema and the TTL helpers in [#8][i8] (B1);
- every contract from [#9][i9] (B2) to [#17][i17];
- the deploy scripts in [#19][i19] (B12), which read the network values this page names;
- the keeper in [#37][i37] (F2);
- the `contractTtlLow` alarm in [#47][i47] (H5);
- the TTL part of [upgradeability-and-governance.md](upgradeability-and-governance.md) ([#49][i49]).

Fee sponsorship through fee-bump transactions and relayers is [#27][i27] (D5). Every
number on this page was read from Stellar testnet (and, where it says so, pubnet)
on 2026-09-19, or comes from a document linked next to it. The per-operation
measurements are tabulated in
[docs/deploy/resource-fees.md](../deploy/resource-fees.md).

[i6]: https://github.com/Square-StellarNetwork/square-stellar/issues/6
[i8]: https://github.com/Square-StellarNetwork/square-stellar/issues/8
[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9
[i17]: https://github.com/Square-StellarNetwork/square-stellar/issues/17
[i19]: https://github.com/Square-StellarNetwork/square-stellar/issues/19
[i27]: https://github.com/Square-StellarNetwork/square-stellar/issues/27
[i37]: https://github.com/Square-StellarNetwork/square-stellar/issues/37
[i47]: https://github.com/Square-StellarNetwork/square-stellar/issues/47
[i49]: https://github.com/Square-StellarNetwork/square-stellar/issues/49

[fees]: https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
[archival]: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival
[persisting]: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/persisting-data
[restore-js]: https://developers.stellar.org/docs/build/guides/archival/restore-data-js
[ops]: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
[simulate]: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction
[ledger-entries]: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries
[lumens]: https://developers.stellar.org/docs/learn/fundamentals/lumens
[oracles]: https://developers.stellar.org/docs/data/oracles/oracle-providers
[cap66]: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md
[cap78]: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0078.md

## The decision

1. **The keeper prices an action from its own simulation.** The cost of a
   `finalize` or `finalize_decided` is the `minResourceFee` that
   `simulateTransaction` returns for the exact transaction the keeper would
   send, plus the inclusion fee it bids, plus the restore fee when the
   simulation asks for one. The `FINALIZE_GAS` constants and their moving
   average go away. The formula is [below](#decision-1-the-profitability-formula).
2. **The XLM/USDC rate comes from a real price source on testnet too.** The
   keeper reads Reflector's SEP-40 oracle "External CEXs & DEXs"
   (`lastprice(Other("XLM"))` and `lastprice(Other("USDC"))`). It refuses a
   price older than two oracle rounds. The SDEX order book is a cross-check,
   and when the book passes it the keeper uses the higher of the two XLM prices.
   **This departs from the issue's option (a), a configured fixed
   `XLM_PER_USDC`.** A fixed rate is a hardcoded value. The team rule forbids
   hardcoded values, and a fixed rate is exactly what that rule is about. It is
   also not needed: the oracle is live on testnet
   ([why](#decision-2-where-the-rate-comes-from)).
3. **The fee is still paid in USDC by pull-payment, and the keeper watches its
   XLM.** `keeper_evaluator` keeps forwarding the evaluator fee (EVM
   `KeeperEvaluator._forwardFee`). So the keeper spends XLM and earns USDC.
   `keeper.low_balance` warns when the XLM the keeper can spend drops below
   `MIN_XLM_BALANCE`. `MIN_XLM_BALANCE` is derived from the chain unless the
   operator sets it.
4. **No contract key uses temporary storage.** Every key is `persistent` or
   lives in `instance`. Each persistent key follows one of four extension
   classes; account settings combine two of them. The class says what the key
   must outlive, and so its `threshold`/`extend_to`. Every number in those rules is a job field, a value
   the network reports, or `env.storage().max_ttl()`. Nothing is typed in. The
   table covering every key is [below](#the-ttl-table).
5. **Archived entries are restored by whoever next needs them.** The keeper does
   this for its own actions, charges the restore to that action's
   profitability, and journals a `restore` row. Contract code, instances and
   global configuration are kept alive by the keeper's sweep.
6. **[docs/deploy/resource-fees.md](../deploy/resource-fees.md) takes over the
   role of `docs/deploy/gas.md`.** `gas.md` stays as the record of the Arc
   deployment.

## What a Soroban transaction costs

### The fee model

The transaction fee is "Resource Fee (`sorobanData.resourceFee`) + Inclusion
Fee". The resource fee is a "Non-refundable resource fee + Refundable resource
fees". The non-refundable part covers "CPU instructions, read bytes, write
bytes, and bandwidth". The refundable part derives "from rent, events, and
return value", and it is "reconciled against actual usage". The fee is set by
`simulateTransaction`, which computes "the necessary resource values and fees"
([fees and metering][fees]).

This matters to the keeper. **What a transaction can be charged is fixed in
its envelope before it is sent:** the declared `resourceFee` plus the inclusion
fee bid. If the declared resource fee is too low, the transaction fails rather
than charging more ([fees and metering][fees]). The Arc keeper needed a margin
for gas-price spikes between estimate and receipt. That spike has no
counterpart here.

Two real transactions show how the parts add up. They were read back with
`getTransaction`:

| Transaction | Declared `resourceFee` | Charged | Non-refundable | Refundable | of which rent | Inclusion |
|---|---|---|---|---|---|---|
| Groth16 `verify`, tx `9427354a…bd31`, ledger 4759823 | 40,108 | 30,591 | 30,451 | 40 | 0 | 100 |
| `fund` through the XLM SAC, tx `0dca3bf8…2249`, ledger 4760307 | 223,296 | 188,125 | 16,951 | 171,074 | 170,136 | 100 |

All values are in stroops (1 XLM = 10,000,000 stroops).

### Why the transfers look expensive

[auth-and-token-flow.md](auth-and-token-flow.md) measured `fund` at
`minResourceFee` 415,664 and `dispute → open → transfer` at 417,197, against
13,200 for `finalize → complete`. Two separate rents make up the difference,
and both were checked on chain.

- **A new persistent balance entry.** The real `fund` created the SAC's
  `Balance` entry for the receiving contract. That is a persistent
  `ContractData` of 216 bytes, created with `liveUntilLedgerSeq` 5,278,707
  (ledger 4,760,307 + 518,400). Rent was **170,136 of the 188,125 stroops
  charged (90 %)**. The 518,400 is the SAC's own `BALANCE_EXTEND_AMOUNT = 30 *
  DAY_IN_LEDGERS` (`soroban-env-host-27.0.1/src/builtin_contracts/stellar_asset_contract/storage_types.rs`).
  After the balance existed, the same `fund` simulated again showed no new
  persistent entry: its state changes are one account update, one created
  temporary entry and one updated balance.
- **The auth nonce, when simulation records authorization.** A `G…` address
  that signs an authorization entry writes a temporary nonce entry of 76 bytes.
  `complete(evaluator)` with a fresh `G…` evaluator was simulated twice at
  ledger 4760651:
  - in recording mode (no signature yet): `minResourceFee` 217,204;
  - with the entry signed and a signature expiration 60 ledgers ahead:
    `minResourceFee` 22,215.

  Instructions differ by 1.5 % (891,646 against 878,622). Almost the whole
  195,000-stroop gap is the nonce's rent. That points to recording mode pricing
  the nonce for a far longer lifetime than a real signature gives it. That is an
  inference from these two numbers; the RPC documentation does not state it.

So the recorded-auth figures in auth-and-token-flow.md are upper bounds. A
wallet or relayer that prices a signed transaction has to simulate again after
signing, with a short signature expiration. `prepareTransaction` in the SDK does
that. The keeper's own `finalize(caller, job_id)` never pays a nonce. When
`caller` is the transaction source, simulation records source-account
credentials and writes nothing: `complete` with the source as evaluator
simulates at 13,276 stroops and 0 write bytes (row 11a of
[resource-fees.md](../deploy/resource-fees.md)). Inside, the evaluator is the
calling contract.

### Rent is not a constant

Two facts make a cached fee wrong sooner or later:

- **The rent rate moves.** The network config prices rent per KB between
  `rentFee1KbSorobanStateSizeLow` (−17,000) and `…High` (10,000). The bounds are
  keyed to the live Soroban state size against `sorobanStateTargetSizeBytes`
  (4,000,000,000). The header of ledger 4760589 reports
  `totalByteSizeOfLiveSorobanState` = 2,783,383,524.
- **Contract code is priced on its in-memory size.** CAP-0066: "in-memory size
  will be used for accounting `CONTRACT_CODE` entries towards the Soroban state
  size, as well as the rent computations". An instantiated module can be "up to
  40x the size" of its ledger entry ([CAP-0066][cap66]). Measured at ledger
  4760637, extending the 3,160-byte Groth16 probe code by about 121,800
  ledgers simulates at 6,099,975 stroops. The 96-byte instance of the same
  contract costs 35,771 for the same extension.

The keeper therefore never reuses a fee. It simulates each action when it is
about to decide.

## Decision 1: the profitability formula

### Inputs

| Input | Unit | Source |
|---|---|---|
| `budget` | USDC base units (7 decimals) | the job record |
| `evaluatorFeeBP` | basis points, 0..10,000 | the job record (snapshotted at `fund`) |
| `resourceFee` | stroops | `simulateTransaction(tx).minResourceFee` for the exact action transaction |
| `inclusionFee` | stroops | the bid the keeper puts in the envelope: `getFeeStats().sorobanInclusionFee[INCLUSION_FEE_PERCENTILE]`, never below the ledger header's `baseFee` |
| `restoreFee` | stroops | `restorePreamble.minResourceFee` + `inclusionFee` when the simulation returns a `restorePreamble`, else 0 |
| `xlmPrice`, `usdcPrice` | oracle units, the same `decimals()` for both | Reflector `lastprice`, [decision 2](#decision-2-where-the-rate-comes-from) |
| `xlmDecimals`, `usdcDecimals` | integers | `decimals()` of the native SAC (`CDLZFC3S…CYSC`) and the USDC SAC (`CBIELTK6…DAMA`): 7 and 7, simulated at testnet ledger 4760790 |
| `marginBps` | basis points | `MINIMUM_MARGIN_BPS` |

`INCLUSION_FEE_PERCENTILE` is an operator setting. It defaults to `p90`, and
this page is where that default is documented. On testnet, `getFeeStats` at
ledger 4760799 read `sorobanInclusionFee` `p90` = 100 and `p99` = 200 over the
last 50 ledgers (573 transactions). The header of ledger 4760589 had `baseFee`
100.

### Functions (all integer, `bigint`)

```
feeStroops    = resourceFee + inclusionFee + restoreFee

keeperFee     = floor(budget × evaluatorFeeBP / 10_000)            // what the contract pays; it floors too

costUsdc      = ceil( feeStroops × xlmPrice × 10^usdcDecimals
                      / (usdcPrice × 10^xlmDecimals) )              // round the cost up

profitable    ⇔ keeperFee × 10_000 ≥ costUsdc × (10_000 + marginBps)   // exact, no division

minimumProfitableBudget(evaluatorFeeBP, costUsdc, marginBps):
    evaluatorFeeBP ≤ 0            → null   (no budget pays a zero fee)
    requiredFee = ceil(costUsdc × (10_000 + marginBps) / 10_000)
    return        ceil(requiredFee × 10_000 / evaluatorFeeBP)
```

With both SACs at 7 decimals, `costUsdc = ceil(feeStroops × xlmPrice /
usdcPrice)`. The oracle's own decimals cancel, because both prices come from
the same feed. Two design points follow from the formula:

- **USDC is priced, not assumed.** The feed's base is USD, so the USDC price is
  read like any other price rather than taken as 1.
- **Rounding always favours the keeper not acting.** The fee is floored, as the
  contract does. The cost and the required fee are rounded up.

`minimumProfitableBudget` returns the smallest budget for which `profitable` is
true. Because the fee is floored, `requiredFee` has to be reached by the floored
fee: `floor(B × bp / 10_000) ≥ F ⇔ B × bp ≥ F × 10_000`. The current
implementation floors `required` instead, which disagrees with `profitable` by
one unit at the boundary. [#37][i37] fixes that when it ports the function.

`decide()` keeps its window and dispute logic unchanged. Only the two
profitability branches change:

- `finalizeDecided` compares `keeperFee` with the cost of the
  `finalize_decided` simulation;
- `finalize` compares it with the cost of the `finalize` simulation.

No price, or a price refused by the rules below, gives
`{ kind: "skip", reason: "noPrice" }`. The keeper fails closed: it does not
spend XLM on a guess. A candidate whose simulation fails is not a profitability
question. It stays on the existing retry path.

### Worked example (a unit test)

This example uses the price snapshot of [decision 2](#the-snapshot-this-page-uses):
`xlmPrice` = 20,090,072,950,292 and `usdcPrice` = 100,008,274,363,637 (14
decimals, oracle timestamp 1789827000, testnet ledger 4760697). The action is the
auth probe's `finalize → complete`, the one contract-to-contract settlement
measured so far: `minResourceFee` 13,200. The bid is 100 (the `p90` above), and
there is no restore.

| Step | Value |
|---|---|
| `feeStroops` | 13,200 + 100 + 0 = **13,300** |
| `feeStroops × xlmPrice` | 267,197,970,238,883,600 |
| `costUsdc` = ceil(… / 100,008,274,363,637) | **2,672** (0.0002672 USDC) |
| budget 1 USDC = 10,000,000, `evaluatorFeeBP` 50 → `keeperFee` | 50,000 |
| profitable at `marginBps` 2,000? | 50,000 × 10,000 = 500,000,000 ≥ 2,672 × 12,000 = 32,064,000 → **true** |
| `requiredFee` at 2,000 | ceil(32,064,000 / 10,000) = **3,207** |
| `minimumProfitableBudget(50, 2,672, 2,000)` | ceil(3,207 × 10,000 / 50) = **641,400** (0.06414 USDC) |
| budget 641,400 | fee 3,207 → 32,070,000 ≥ 32,064,000 → **true** |
| budget 641,399 | fee 3,206 → 32,060,000 < 32,064,000 → **false** |
| `marginBps` 0 | `requiredFee` 2,672, `minimumProfitableBudget` 534,400; 534,399 gives fee 2,671 → false |
| `evaluatorFeeBP` 0 | `minimumProfitableBudget` → `null`; `profitable` false for every budget |

The probe's `finalize` writes nothing, so a real `finalize` costs more. It pays
`complete`, the hook, the fee transfer and TTL extensions. With a compliance
module it also verifies the proof three times, about 30 M instructions each and
about 90 M in all ([call-graph-on-soroban.md](call-graph-on-soroban.md#5-tolerant-hook-calls-what-a-hook-informs-it-never-vetoes-means-on-soroban)).
The table exercises the formula.
It is not a forecast. The real figure arrives with the B-cluster contracts, and
the keeper never uses a figure from this page anyway: it simulates.

### What `MINIMUM_MARGIN_BPS` means now

On Arc the margin absorbed gas-price movement between the estimate and the
receipt. On Stellar the envelope caps the charge, so that risk is gone. The
margin now covers two things:

- **Price risk.** The XLM price can move between the oracle round the keeper
  read (up to two rounds old) and the moment the keeper converts its USDC.
- **The venue gap.** The oracle's aggregate price can differ from the price the
  keeper actually converts at.

The margin is a policy choice of the operator, not a network fact. Its default
stays 2,000 (20 %), the value `services/keeper/src/main.ts` already uses.

## Decision 2: where the rate comes from

### Why not a fixed rate

The issue's first option was a configured `XLM_PER_USDC`, "enough for testnet".
It is rejected:

- **It is hardcoded.** The team rule forbids hardcoded rates, prices and limits.
  The hackathon eliminates projects whose functionality is mocked or hardcoded.
- **It is wrong the moment it is written.** The two snapshots on this page are
  15 minutes apart, and the XLM price moved from 0.198857 to 0.200901 USD
  (+1.0 %).
- **A real source exists on testnet.** The Stellar documentation lists
  Reflector's testnet contracts next to its mainnet ones ([oracle
  providers][oracles]).

The issue's option (c) limited an oracle to mainnet and a later issue. The
testnet feed makes that restriction unnecessary.

### The source: Reflector "External CEXs & DEXs"

| | Testnet | Mainnet |
|---|---|---|
| External CEXs & DEXs (used) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN` |
| Stellar Mainnet DEX (not used) | `CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP` | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` |
| Fiat exchange rates (not used) | `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` | `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC` |

All six addresses come from the [oracle providers][oracles] page, which says the
feeds are "compatible with SEP40". The three testnet contracts were read on
chain by simulation, with nothing sent and nothing paid. The helper is
`contracts/probes/scripts/lib/stellar.mjs`.

- **CEX feed.** `base()` = `Other("USD")`, `decimals()` = 14,
  `resolution()` = 300 (seconds). `lastprice` answers for `Other("XLM")`,
  `Other("USDC")`, `Other("USDT")` and `Other("EURC")`.
- **DEX feed.** Its base and assets are `Stellar(C…)` contract addresses. None
  of them is the testnet USDC SAC (`CBIELTK6…DAMA`) or the testnet native SAC
  (`CDLZFC3S…CYSC`), so it cannot price the testnet tokens by address.
- **Fiat feed.** It carries fiat currencies (EUR, GBP, CHF, CAD, MXN, ARS, BRL,
  THB, XAU). The keeper needs none of them: the CEX feed prices both sides
  against USD.

**Only the keeper reads the oracle. No contract does.** The keeper reads it
off chain by `simulateTransaction`, which costs nothing (`lastprice` simulates
at about 865,000 instructions and is never sent). The price therefore decides
only whether the keeper spends its own XLM. An oracle that is wrong, stale or
malicious cannot move escrowed USDC, change a fee, or block anyone else from
calling `finalize`, which stays permissionless.

### The snapshot this page uses

Read at testnet ledger **4760697** (2026-09-19 14:11 UTC):

| Call | Result |
|---|---|
| `lastprice(Other("XLM"))` | `price` 20,090,072,950,292, `timestamp` 1789827000 (14:10:00 UTC) → 0.20090072950292 USD |
| `lastprice(Other("USDC"))` | `price` 100,008,274,363,637, same timestamp → 1.00008274363637 USD |
| `last_timestamp()` | 1789827000 |
| ratio | 1 XLM = 0.2008841 USDC; 1 USDC = 4.9779946 XLM |

An earlier read at ledger 4760539 (oracle timestamp 1789826100) gave XLM
19,885,742,312,186 and USDC 100,015,327,138,136.

### Rules the keeper applies

1. **Freshness.** Both `lastprice` answers must be present (`Some`), and each
   `timestamp` must satisfy `now − timestamp < 2 × resolution()`. Here `now` is
   the `closeTime` of the latest ledger (`getLatestLedger`), the same chain
   clock the keeper already uses for windows. `resolution()` is read from the
   contract, not assumed. The factor 2 accepts the latest round or the one
   before it, and it is documented here as the single source.
2. **Cross-check against the SDEX.** The keeper reads Horizon `order_book` for
   `selling=native`, `buying=USDC:<issuer>` on the network whose USDC it is
   paid in. The mid-price counts only when the book's relative spread
   `(ask − bid) / mid` is at most `MINIMUM_MARGIN_BPS`: a book whose own
   uncertainty exceeds the margin cannot check anything.
3. **Conservative choice.** When the book counts, the XLM price used is
   `max(oracle, sdexMid)`, because a higher XLM price means a higher cost. If
   the two differ by more than `MINIMUM_MARGIN_BPS`, the keeper logs
   `keeper.price_disagreement`.
4. **Fallback.** If the oracle fails rule 1 and the book passes rule 2, the book
   mid is used alone. If neither passes, the keeper skips with `noPrice`.

The books at the same moment:

| Book | Ledger | Best bid | Best ask | Mid | Spread | Mid vs oracle |
|---|---|---|---|---|---|---|
| pubnet `XLM/USDC:GA5Z…KZVN` | 64508259 | 0.2002611 | 0.2005007 | 0.2003809 | 12 bps | −25 bps |
| testnet `XLM/USDC:GBBD…FLA5` | 4760698 | 0.1080000 | 1.0000000 | 0.554 | 16,101 bps | +17,578 bps |

On pubnet the book agrees with the oracle to 0.25 %, and it passes rule 2 at
the default margin. On testnet the "market" is a handful of test offers 9× apart,
and rule 2 discards it. So the testnet keeper relies on the oracle alone and
skips with `noPrice` when the oracle is stale. That is also why Horizon's SDEX
price, the issue's option (b), cannot be the primary source on testnet.

## Decision 3: fee withdrawal and the keeper's XLM

- **The fee path does not change.** `keeper_evaluator.finalize` and
  `finalize_decided` forward the evaluator fee in USDC to the keeper that
  submitted them, in the same transaction.
- **The keeper needs a USDC trustline.** It receives USDC at a `G…` address, so
  without a USDC trustline the forward fails, and with it the `finalize`
  ([auth-and-token-flow.md](auth-and-token-flow.md)). The keeper checks the
  trustline at startup.
- **`MIN_XLM_BALANCE`, in stroops.** It is optional. When it is unset, the
  keeper derives it on every health check:
  - `spendable = balance − minimumBalance − selling liabilities`, with
    "available balance = balance - minimum balance - liabilities.selling"
    ([lumens][lumens]);
  - `minimumBalance = (2 + subentry_count + num_sponsoring − num_sponsored) ×
    baseReserve`. `baseReserve` comes from the latest ledger header: 5,000,000
    stroops (0.5 XLM) on testnet at ledger 4760589. The counters come from
    Horizon `accounts/{id}`.
  - `required = MIN_ACTIONS_FUNDED × maxRecentFee`. Here `maxRecentFee` is the
    largest `feeStroops` the keeper simulated in its last tick, the TTL sweep
    included. `MIN_ACTIONS_FUNDED` already exists and defaults to 3.
  - When `spendable < required`, the keeper logs `keeper.low_balance` once per
    transition, with `spendable`, `required`, `source` (`operator` or
    `derived`), `minimumBalance` and `baseReserve`. The `balance` health check
    turns critical, as it does today.

## Decision 4: TTL policy

### What the network does

- **Three storage kinds.** Temporary is "permanently deleted when TTL goes to 0,
  cannot be restored". Persistent and instance are "archived when TTL goes to 0"
  and "automatically restored via the InvokeHostFunction operation". Instance
  storage "shares the same TTL as the contract instance" ([state
  archival][archival]).
- **Limits, read on testnet** (`CONFIG_SETTING_STATE_ARCHIVAL`, ledger 4759830).
  `minPersistentTtl` is 120,960 and `minTemporaryTtl` is 720. The minimum is
  applied at creation: the Groth16 probe instance, deployed in the run that
  started at ledger 4,759,817, lives until 4,880,780, which is 120,963 ledgers
  after that start. `maxEntryTtl` is 3,110,400. `env.storage().max_ttl()`
  returns `max_live_until_ledger − sequence`, the "maximum extension via
  `extend_ttl`" (`soroban-sdk-27.0.6/src/storage.rs`).
- **Ledger pace.** `CONFIG_SETTING_SCP_TIMING.ledgerTargetCloseTimeMilliseconds`
  = 5,000 at ledger 4760589. Ledgers 4,750,000 → 4,760,589 closed in 52,945 s,
  which is 5.000 s per ledger.
- **Extension semantics.**
  - `extend_ttl(key, threshold, extend_to)` "extends the TTL only if the TTL for
    the provided data is below `threshold` ledgers. The TTL will then become
    `extend_to`" (sdk `storage.rs`). The host refuses `threshold > extend_to`.
  - It clamps a persistent entry to `max_live_until`, and it traps on a
    temporary entry asked to go past the maximum
    (`soroban-env-host-27.0.1/src/storage.rs`, `extend_ttl`).
  - [CAP-0078][cap78] (Protocol 26) adds `extend_ttl_with_limits(key,
    extend_to, min_extension, max_extension)`, which sdk 27.0.6 exposes for
    persistent keys, the instance and the deployer.
- **Anyone may extend.** "There is no access control for TTL extension
  operations. Any user may invoke `ExtendFootprintTTLOp` on any LedgerEntry"
  ([persisting data][persisting]). The operation's `extendTo` is "the minimum
  TTL that all the entries in the read-only footprint will have", counted in
  ledgers from the current one (JS SDK `extendFootprintTtl`). [List of
  operations][ops] describes the parameter as a ledger sequence number. The two
  disagree, and the SDK text matches the XDR use.
- **Who pays.** Every TTL extension and every restoration is paid by the source
  account of the transaction that performs it, or by the fee-bump sponsor
  ([#27][i27]). The owner is never charged implicitly.

### Principles

1. **Nothing whose loss moves money, or reopens a replay, is temporary.** A
   deleted temporary entry reads as "absent". For a daily spend counter,
   "absent" means "nothing spent". For a consumed-statement marker it means
   "never used". For a sanctions record it means "no finding". Temporary
   storage would turn each of those into a bypass the moment the conversion
   from seconds to ledgers is off. An archived persistent entry cannot be
   mistaken for an absent one. A transaction that touches it must restore it
   first.
2. **Archival costs money but never loses state.** Since Protocol 23 an
   archived persistent or instance entry is restored before the host function
   runs, "if they're included in the transaction's restore list" ([state
   archival][archival], [CAP-0066][cap66]). So a TTL rule decides only who
   pays and when. It never decides whether the state survives.
3. **Each key is extended by the party whose action next needs it, up to the
   moment the protocol next expects it to be touched.** That moment is the job's
   own `expired_at + settlement_horizon`, a dispute's `resolve_by`, a proof's
   timestamp window, a screening's `max_age`, or the end of a policy day. After
   that moment, whoever touches the key pays to restore it.
4. **No typed-in ledger counts.** Seconds become ledgers with the network's
   target close time. Caps come from `max_ttl()`. The refresh threshold for
   global state is the network's `minPersistentTtl`.

### Seconds to ledgers: `TtlConfig`

A contract can read `sequence()`, `timestamp()` and `max_live_until_ledger()`,
but not the network's config settings. So each contract keeps in instance
storage the two config values its rules need. The deploy scripts ([#19][i19])
read them from the network, and the constructor stores them:

| Field | Network source | Testnet, 2026-09-19 |
|---|---|---|
| `ledger_close_ms` | `CONFIG_SETTING_SCP_TIMING.ledgerTargetCloseTimeMilliseconds` | 5,000 |
| `min_persistent_ttl` | `CONFIG_SETTING_STATE_ARCHIVAL.minPersistentTtl` | 120,960 |

The keeper compares both with the live config on every sweep and logs
`keeper.ttl_config_drift` when they differ. In every contract that has an owner,
an owner-only `set_ttl_config` updates them; it is listed with the other owner
functions in [upgradeability-and-governance.md](upgradeability-and-governance.md#owner-authority-per-contract).
`claim_market` has no owner, so its `TtlConfig` stays as the constructor stored
it: its drift is logged and is corrected only by the next deployment. If
ledgers close faster than `ledger_close_ms`, an entry lives for less time than
intended. That costs a restore and never loses state (principle 2).

`ledgers_for(s) = ceil(s × 1000 / ledger_close_ms)` and `ledgers_until(ts) =
ts > now ? ledgers_for(ts − now) : 0`.

### The four classes

| Class | Keys | Extended when | Rule |
|---|---|---|---|
| **J: job-scoped** | everything keyed by a job id | on every write, and on every read inside a state-changing call | `T = min(max_ttl, ledgers_until(job.expired_at + job.settlement_horizon))`; if `T > 0`: `extend_ttl(key, threshold = T, extend_to = min(max_ttl, T + ledgers_for(job.settlement_horizon)))` |
| **D: dispute-scoped** | per-dispute keys in `keeper_evaluator` and `arbitration` | the same | as J, with the end moved to `max(job.expired_at, resolve_by) + job.settlement_horizon`, because a window added after `create_job` can put `resolve_by` past `expired_at` (the EVM inventory's observation 4) |
| **U: until a timestamp** | keys whose meaning ends at a known time | on write | `T = min(max_ttl, ledgers_until(end))`; if `T > 0`: `extend_ttl(key, T, T)` |
| **G: global configuration** | sets and settings the owner writes and no job owns | on write by the owner: `extend_ttl(key, min_persistent_ttl, min_persistent_ttl)`; afterwards by the keeper's sweep | sweep: when the remaining TTL `< min_persistent_ttl`, `ExtendFootprintTTL` to `2 × min_persistent_ttl` |

Account configuration (`Policy`, `BuyerRoot`) belongs to no class of its own.
Its setter applies the G setter rule. Every job that uses it applies that job's
J rule. The sweep never touches it, because no operator should pay rent for a
user's settings.

Why the J rule looks the way it does:

- **The end is `expired_at + settlement_horizon`.** On the EVM, `create_job`,
  `fund` and `submit` require `expired_at ≥ now + max(horizon, 15 min)`. That
  puts every step of the normal flow (challenge, dispute, grace, `finalize`)
  before `expired_at`. After `expired_at`, `claim_refund` opens. The rule keeps
  a job's entries live for one more horizon after that.
- **The slack is one horizon.** Once extended, an entry already covers the
  end. A later write extends it again only if the ledgers have drifted from the
  target pace by more than one horizon, so small drifts never cost a TTL
  write.
- **Most jobs never extend.** A new persistent entry already lives
  `minPersistentTtl` ledgers (120,960 ≈ 7 days on testnet). With the testnet
  horizon of 1,020 s (204 ledgers) and an expiry one day out, `T` = 17,484, and
  `extend_ttl` is a no-op. With an expiry 30 days out, `T` = 518,604 and the
  entry is extended to 518,808.
- **The longest coverage is `max_ttl`.** On testnet that is 3,110,400 ledgers,
  or 180 days. A job that expires later still works: its entries archive in
  between, and the next party to act restores them.

Why the G sweep uses `minPersistentTtl`:

- It is the network's own idea of the shortest life of a fresh entry.
- Keeping at least that much left means a keeper outage shorter than that
  archives nothing.
- Topping up by the same amount keeps each sweep's cost proportional to the time
  it buys. Rent is linear in ledgers: the code-extension simulations at +121,778
  and +398,258 ledgers cost 6,099,975 and 19,915,659 stroops, 50.1 and 50.0 per
  ledger.

### The TTL table

Keys are named as the EVM storage they replace. [#8][i8] fixes the Soroban names
and may merge keys. A merged key takes the strictest rule of its parts. "Payer"
is the source account of the transaction that runs the rule, or its fee-bump
sponsor.

#### `square_job`

| Key (EVM origin) | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; payment token and any other constructor-fixed value (EVM immutables `_paymentToken`, `_hookGasLimit`, if [#8][i8] keeps a counterpart of the latter); job counter; `platform_fee_bp`, `evaluator_fee_bp`, treasury; pending fees and `fees_effective_from`; `total_withdrawable`, `total_escrowed`; `TtlConfig` | instance | — | the instance rule [below](#instance-and-code) | owner transactions; keeper sweep |
| `Job(job_id)` → `JobRecord` (`_jobs`); the record also carries the policy pin `commitment_at_fund`, which the EVM hook kept as `_commitmentAtFund` ([call-graph-on-soroban.md](call-graph-on-soroban.md#1-push-model-hookcontext)) | persistent | J | on `create_job`, `set_provider`, `set_budget`, `fund`, `submit`, `complete`, `reject`, `claim_refund` | the actor: client, provider, evaluator or keeper, refund claimer |
| `ComplianceProof(job_id)` → bytes ≤ 1,024 (`_complianceProofs`) | persistent | J | on `set_compliance_proof`, and on the read in `complete` | client; then the evaluator's submitter (the keeper) |
| `Withdrawable(address)` (`_withdrawable`) | persistent | J, of the job that credits it | on each credit, with the crediting job's end; `withdraw`/`withdraw_to` removes the key when it reaches zero | the crediting action's submitter; a holder whose balance was archived pays its restore on `withdraw` |
| `HookWhitelisted(address)` (`_whitelistedHooks`) | persistent | G | on `set_hook_whitelist`; then the sweep | owner; keeper |

#### `keeper_evaluator`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; `square_job`; `arbitration` (set once); window count; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `Window(i)` (`_windows`, append-only) | persistent | G | on `configure_windows` / `set_finalize_grace`; then the sweep, which covers every window because a job's challenge end is read from the window in force at its `submitted_at` | owner; keeper |
| `Dispute(job_id)` → `DisputeRef` (`_disputes`) | persistent | D | on `dispute`, `apply_rejection`, `finalize_decided` | disputer (client); the arbiter whose vote decides (through `apply_rejection`); keeper |

#### `arbitration`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; token, `keeper_evaluator`, `square_job`; `current_version`, `bond_bps`, `min_bond`; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `Arbiters(version)`, `Threshold(version)`, `ArbiterIndex(version, address)` | persistent | G | on `set_arbiters`; then the sweep. Old versions are swept while a dispute opened under them is undecided | owner; keeper |
| `Dispute(job_id)` → `Dispute` (`_disputes`) | persistent | D | on `open`, `vote`, `lapse`, `settle_bond` | disputer; arbiter; lapse caller; bond settler |
| `Approval(job_id, hash)` (`_approvals`) | persistent | D | on `vote` | arbiter |
| `Withdrawable(address)` (`_withdrawable`) | persistent | D, of the dispute that credits it | on each credit; removed at zero on withdrawal | the crediting action's submitter; the holder on restore |

#### `claim_market`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| `square_job`, `keeper_evaluator`, token, `policy_registry`; `TtlConfig` (no owner) | instance | — | instance rule (sweep only) | keeper |
| `Listing(job_id)` (`_listings`) | persistent | J | on `list`, `buy`, `cancel` | seller; buyer |

#### `square_hook`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; kernel, token, market, identity/reputation/validation registries; `compliance_module`, `screening`, `trusted_evaluator`, `min_reputation_budget`; the reputation and validation write switches; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `BoundAgent(job_id)` (`_boundAgentPlusOne`) | persistent | J | on `before_action(SUBMIT)` | provider |
| `ValidationOf(job_id)` (`_validationOf`) | persistent | J | on write | the action's submitter |
| `Recorded(job_id)` (`_recorded`) | persistent | J | on `after_action`, `record_expiry` (after expiry `T` is usually 0: no extension) | keeper; expiry recorder |
| EVM transient slots (`_checkedJob`, `_checkOutcome`, `_screenOutcome`, `_screenCommitment`) | none | — | not carried between transactions. How the before-action outcome reaches the after-action code is fixed with the call graph, not here | — |

#### `compliance_module`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; hook, verifier, registry, kernel; `timestamp_tolerance`; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `Consumed(statement)` (`_consumed`) | persistent | U | end = the proof's timestamp signal + `timestamp_tolerance`. After that the proof fails the timestamp binding anyway, and an archived marker still blocks until it is restored | the evaluator's submitter (the keeper) |

#### `policy_registry`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `Policy(poster)` (`_policies`) | persistent | G on write; J on use | setter: `set_policy` extends to `min_persistent_ttl`. Use: `fund` (the pin) extends it with the funded job's J rule | poster; client at `fund` |
| `DailySpend(poster)` (`_spend`) | persistent | U | end = start of the next policy day (`(day + 1) × 86,400`), on `record_spend`. It must not be temporary (principle 1) | the evaluator's submitter (the keeper) |
| `BuyerRoot(poster)` (`_buyerRoots`) | persistent | G on write; J on use | setter extends to `min_persistent_ttl`. `claim_market.buy` reads it and extends it with the job's J rule | poster; buyer |
| `Spender(address)` (`_spenders`) | persistent | G | on `set_spender`; then the sweep | owner; keeper |

#### `screening_registry`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| owner, pending owner; `max_age`; `TtlConfig` | instance | — | instance rule | owner; keeper |
| `Record(subject)` (`_records`) | persistent | U | end = `screened_at + max_age`. After that, `is_cleared` is false anyway. A deleted sanctioned record could let an older "cleared" one back in, which is why it is not temporary | whoever submits the screening (a screener's relay or the keeper) |
| `Screener(address)` (`_screeners`) | persistent | G | on `set_screener`; then the sweep | owner; keeper |

#### `groth16_verifier`

| Key | Storage | Class | Extension rule | Payer |
|---|---|---|---|---|
| none: the key is embedded in code ([groth16-on-soroban.md](groth16-on-soroban.md)) | instance | — | instance rule | keeper |

#### Entries that are not ours, but that we depend on

| Entry | Owner | TTL behaviour | Consequence |
|---|---|---|---|
| USDC SAC `Balance(contract)` for `square_job` and `arbitration` (escrow) | the SAC | every read or write of a contract balance calls `extend_ttl(BALANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT)`, 29 and 30 days of ledgers (`soroban-env-host-27.0.1/…/stellar_asset_contract/balance.rs`); the created entry above lived 518,400 ledgers | the first touch each day pays about one day of rent. A contract whose USDC sits untouched for 30 days has its balance archived, and the next transfer restores it and pays for that |
| a `G…` account's USDC | a classic trustline | no TTL | none |
| auth nonces | the host, temporary | live until the signature's expiration ledger | a short expiration keeps them cheap ([above](#why-the-transfers-look-expensive)) |

### Instance and code

- **Owner transactions.** Every owner function calls
  `env.deployer().extend_ttl_for_contract_instance(current, min_persistent_ttl,
  2 × min_persistent_ttl)`. That extends the instance only. It deliberately
  avoids `instance().extend_ttl`, which "extend[s] the TTL of the contract
  instance and code" (sdk `storage.rs`). Code is the expensive entry: about 50
  stroops per ledger for a 3,160-byte module (above). Nobody should pay for it
  inside an ordinary call.
- **The keeper's sweep.** Every sweep interval, for each of the nine contracts,
  the keeper reads `liveUntilLedgerSeq` of the instance, the code and every
  class-G key through `getLedgerEntries`.
  - When a remaining TTL is `< min_persistent_ttl`, it sends one
    `ExtendFootprintTTL` per contract with `extendTo = 2 × min_persistent_ttl`,
    at most `txMaxFootprintEntries` (400) keys per transaction.
  - It journals an `extend` row in `keeper_actions` with the fee charged.
  - The sweep's simulated fee counts toward `maxRecentFee` (decision 3).
- **The alarm.** `contractTtlLow` ([#47][i47]) fires when any code or instance
  entry has fewer than `min_persistent_ttl / 2` ledgers left (about 3.5 days on
  testnet). A working sweep tops a TTL up as soon as it drops below
  `min_persistent_ttl`, so the alarm means the sweep has been missing for half the network's minimum
  lifetime, with the other half left to act. The factor ½ is documented here as
  the single source.
- **Cost, for scale.** Only the Groth16 probe has been measured. Extending its
  code by about 121,800 ledgers costs 6,099,975 stroops (≈ 0.61 XLM, about 7
  days' rent). The nine contracts' code is not written yet
  ([resource-fees.md](../deploy/resource-fees.md)).

## Decision 5: restoring from the archive

The source of truth is the simulation. `getLedgerEntries` is the cheap
pre-check. It reports `liveUntilLedgerSeq`, which "may be zero if the entry is
no longer live" ([getLedgerEntries][ledger-entries]).

For its own actions, the keeper runs these steps for each candidate whose
window has closed:

1. It simulates the action transaction.
2. **Restore needed.** If the simulation returns a `restorePreamble` ("archived
   ledger entries which need to be restored before the submission of the
   `InvokeHostFunction` operation", [simulateTransaction][simulate]):
   - `restoreFee = restorePreamble.minResourceFee + inclusionFee` joins
     `feeStroops`, and `decide()` runs on the total;
   - if the total is profitable, the keeper sends `RestoreFootprint` with the
     preamble's `transactionData`, journals `{ action: "restore", jobId, fee }`
     in `keeper_actions`, simulates again, and sends the action ([restore
     guide][restore-js]);
   - if the total is not profitable, it is an ordinary `unprofitable` skip, and
     the log carries `restoreFee`.
3. **Restore folded into the action.** If the simulation instead lists archived
   keys in the action's own `SorobanTransactionData` (automatic restoration,
   `archivedSorobanEntries` in [CAP-0066][cap66]), the restore is already inside
   `minResourceFee`. The keeper journals the `restore` row when the action
   lands.
4. **`RestoreFootprint` alone.** It is needed only when restoring inside the
   action "would exceed resource limits" ([CAP-0066][cap66]). Step 2 covers
   that case.

For everyone else, the SDK ([#23][i23]) does the same on every write:

- it simulates, sends `RestoreFootprint` when a preamble comes back, and then
  sends the call;
- the user (or the relayer of [#27][i27]) pays;
- a client restoring an archived job to `claim_refund` pays for its own job;
- a holder withdrawing an archived balance pays for its own balance.

Nothing in this flow needs the owner. An archived contract instance or code
entry is restored the same way, by anyone
([upgradeability-and-governance.md](upgradeability-and-governance.md)).

[i23]: https://github.com/Square-StellarNetwork/square-stellar/issues/23

## TTL constants draft for [#8][i8]

This is a draft for B1 to implement in the shared crate. It contains no ledger
count as a literal. Every number is a job field, a stored network value, or
`max_ttl()`.

```rust
/// Stored in each contract's instance storage by `__constructor`. The deploy
/// scripts (#19) read both values from the network's CONFIG_SETTING entries;
/// they are never typed in. `set_ttl_config` (owner) updates them when the
/// network changes them; the keeper reports drift.
#[contracttype]
#[derive(Clone)]
pub struct TtlConfig {
    /// CONFIG_SETTING_SCP_TIMING.ledgerTargetCloseTimeMilliseconds
    pub ledger_close_ms: u32,
    /// CONFIG_SETTING_STATE_ARCHIVAL.minPersistentTtl
    pub min_persistent_ttl: u32,
}

pub fn ledgers_for(cfg: &TtlConfig, seconds: u64) -> u32 {
    let ms = seconds.saturating_mul(1000);
    let close = u64::from(cfg.ledger_close_ms);
    u32::try_from(ms.div_ceil(close)).unwrap_or(u32::MAX)
}

pub fn ledgers_until(env: &Env, cfg: &TtlConfig, ts: u64) -> u32 {
    let now = env.ledger().timestamp();
    if ts <= now { 0 } else { ledgers_for(cfg, ts - now) }
}

/// Class U: keep `key` live at least until `end` (a timestamp).
pub fn extend_until<K: IntoVal<Env, Val>>(env: &Env, cfg: &TtlConfig, key: &K, end: u64) {
    let t = ledgers_until(env, cfg, end).min(env.storage().max_ttl());
    if t > 0 {
        env.storage().persistent().extend_ttl(key, t, t);
    }
}

/// Classes J and D: keep `key` live until `end + horizon`, with one horizon of slack.
pub fn extend_for_settlement<K: IntoVal<Env, Val>>(
    env: &Env, cfg: &TtlConfig, key: &K, end: u64, horizon: u64,
) {
    let max = env.storage().max_ttl();
    let t = ledgers_until(env, cfg, end.saturating_add(horizon)).min(max);
    if t > 0 {
        let to = t.saturating_add(ledgers_for(cfg, horizon)).min(max);
        env.storage().persistent().extend_ttl(key, t, to);
    }
}
// J: end = job.expired_at.  D: end = max(job.expired_at, dispute.resolve_by).
// horizon = job.settlement_horizon in both.

/// Class G setters: a fresh write lives at least as long as a fresh entry.
pub fn extend_config<K: IntoVal<Env, Val>>(env: &Env, cfg: &TtlConfig, key: &K) {
    env.storage().persistent().extend_ttl(key, cfg.min_persistent_ttl, cfg.min_persistent_ttl);
}

/// Owner transactions: instance only, never the code.
pub fn extend_instance(env: &Env, cfg: &TtlConfig) {
    let to = cfg.min_persistent_ttl.saturating_mul(2).min(env.storage().max_ttl());
    let threshold = cfg.min_persistent_ttl.min(to); // the host requires threshold <= extend_to
    env.deployer()
        .extend_ttl_for_contract_instance(env.current_contract_address(), threshold, to);
}
```

Tests B1 owes this draft (in the Rust suite of [#18](https://github.com/Square-StellarNetwork/square-stellar/issues/18)):

- **Expiry within the minimum lifetime.** A job created with `expired_at` one
  day out keeps the TTL it was created with.
- **Expiry 30 days out.** The TTL reaches `ledgers_for(30 days + horizon)` plus
  one horizon.
- **Expiry past `max_ttl`.** The TTL is clamped, and the host does not trap.
- **A second write inside the hysteresis** does not change `live_until`.
- **An archived job is restored.** In the test environment, advance past
  `live_until` and check that `claim_refund` still refunds.
- **`DailySpend` and `Consumed` are persistent** (their durability is asserted).

## Alternatives, and why each was rejected

| Alternative | Why not |
|---|---|
| **A fixed `XLM_PER_USDC` in configuration** (the issue's option a) | Hardcoded. The team rule and the hackathon's criteria exclude it. It was also 1 % stale within the 15 minutes between the two reads on this page. |
| **SDEX mid-price as the primary source** (option b) | On testnet the USDC/XLM book is 16,101 bps wide and 17,578 bps away from the oracle. On pubnet it is a good cross-check, and it is used as one. |
| **The oracle only on mainnet, in a later issue** (option c) | The testnet feed exists, and it is on the official providers list. |
| **Contracts reading the oracle on chain** | Nothing on chain needs a price: the fee is a percentage of the budget. Reading the oracle on chain would make a third-party contract part of settlement. Keeping it off chain confines a bad price to the keeper's own XLM. |
| **Temporary storage for `DailySpend`, `Consumed` or screening records** | Cheaper, but deletion reads as "nothing spent", "never used" or "no finding". Safety would then depend on the seconds-to-ledgers conversion never running fast (principle 1). |
| **Extending every entry to `max_ttl` on every write** | The first writer of each entry prepays 180 days of rent for state that settles in hours. CAP-0078 exists because "some users may end up paying much more than the others" ([CAP-0078][cap78]). |
| **`instance().extend_ttl` in ordinary calls** | It extends the code too, at the in-memory size ([CAP-0066][cap66]). The sweep extends the code, and only when it is due. |
| **A constant `FINALIZE_GAS`-style resource fee** | Rent moves with state size and entry age, and restores come and go. A simulation is free and exact. A constant is neither. |

## What is not measured or not verified

- **The real lifecycle calls are not measured.** `create_job`, `fund` into
  `square_job`, `submit`, `finalize`, `finalize_decided`, `vote`, `list`,
  `buy`, `withdraw` and `claim_refund` need the B-cluster contracts.
  [resource-fees.md](../deploy/resource-fees.md) lists them as open rows.
- **`RestoreFootprint` is not measured.** No archived entry of ours exists yet.
- **One inference is not in any document.** That recording-mode simulation
  prices the auth nonce for a long lifetime is inferred from 217,204 against
  22,215 stroops. It is not stated in the RPC documentation.
- **The rent rate is not derived.** Its formula from the state-size parameters
  is not reproduced here. The measured rents are used as they came.
- **Automatic restoration versus `restorePreamble` is not observed.** Which of
  the two a current RPC returns for an archived key in an invocation has not
  been seen on our contracts. Decision 5 handles both.
