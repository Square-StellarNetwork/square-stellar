# Storage layout, error codes and event schema

**Status:** decided in [#8][i8] (B1). It builds on the TTL policy of
[#6][i6] ([fees-and-ttl.md](../decisions/fees-and-ttl.md)), the call graph of
[#3][i3] ([call-graph-on-soroban.md](../decisions/call-graph-on-soroban.md))
and the owner of [#49][i49]
([upgradeability-and-governance.md](../decisions/upgradeability-and-governance.md)).
The contracts of [#9][i9] to [#17][i17] implement it. The indexer
([#36][i36]) decodes by it, and `@squaresdk/core` ([#23][i23]) names errors
by it.

[i3]: https://github.com/Square-StellarNetwork/square-stellar/issues/3
[i6]: https://github.com/Square-StellarNetwork/square-stellar/issues/6
[i8]: https://github.com/Square-StellarNetwork/square-stellar/issues/8
[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9
[i17]: https://github.com/Square-StellarNetwork/square-stellar/issues/17
[i23]: https://github.com/Square-StellarNetwork/square-stellar/issues/23
[i36]: https://github.com/Square-StellarNetwork/square-stellar/issues/36
[i49]: https://github.com/Square-StellarNetwork/square-stellar/issues/49

**Three sections of this page are generated:** the error codes, the events
and the storage keys.

- **Source.** They are written from the definitions in `contracts/common`
  (`errors/`, `events/`, `keys/`, `owner.rs`, `ttl.rs`), by
  `contracts/common/tests/schema.rs`. The same run writes
  `contracts/common/errors.json`.
- **Check.** `cargo test` fails when this page or the JSON no longer matches
  the code.
- **Change.** Edit the Rust definition, then run
  `SQUARE_WRITE_SCHEMA=1 cargo test -p square-common --test schema`.
- **Examples.** Every event example is the event's own encoding, printed as
  the network's JSON (what `getEvents` returns with `xdrFormat: json`).

**The rule this page enforces:** every state transition emits enough for an
indexer to rebuild the state without a second call to the chain. If the
indexer ever has to simulate a read to fill a gap, this schema is wrong, and
the fix lands here, not in the indexer.

## Units

| Question | Decision |
|---|---|
| Token | The USDC Stellar Asset Contract: testnet `CBIELTK6…DAMA`, pubnet `CCW67TSZ…MI75` ([stellar-target.md](../decisions/stellar-target.md)). It has 7 decimals, and every amount on this page is in its base units. |
| Amount width | A job's budget is stored as `u64` (`JobRecord.budget`), because the circuit's ceiling is `Num2Bits(64)`. An amount that fits storage therefore always fits the proof. Token amounts everywhere else (balances, credits, events, `withdraw_to`) are `i128`, the SAC's type. The policy registry's counters are `u128`, as they were `uint128` on EVM. |
| Basis points | `u32`, out of 10 000. `#[contracttype]` has no `u16`. |
| Time | `u64` seconds, the ledger's close time. TTLs are counted in ledgers (`u32`), and [fees-and-ttl.md](../decisions/fees-and-ttl.md#seconds-to-ledgers-ttlconfig) converts one to the other. |
| Job ids | `u64`, from 1. |
| Agent ids | `u32`, the 8004 identity registry's type ([8004-registries-on-stellar.md](../decisions/8004-registries-on-stellar.md)). |

## Contracts

| Contract | Role | Holds USDC |
|---|---|---|
| `square_job` | The ERC-8183 kernel. It holds the job lifecycle, the escrow, the fee snapshot, the pull-payment ledger and the hook whitelist. | Yes: every escrowed budget and every unclaimed payout. |
| `keeper_evaluator` | The evaluator seat of every optimistic job. It runs the challenge window, permissionless finalize, keeper fee forwarding and dispute entry. | Transiently: one evaluator fee at a time, forwarded in the same call. |
| `arbitration` | Bonded disputes, a versioned arbiter set, M-of-N votes by bitmask, and the decision record. | Yes: dispute bonds until they are withdrawn. |
| `claim_market` | Receivable listing, purchase, cancellation and payee lookup. | No: the price moves from buyer to seller directly. |
| `square_hook` | The one whitelisted hook. It does payout routing, the compliance and screening slots, and the reputation and validation writes. | No. |
| `compliance_module` | The proof gate the hook calls. It verifies the Groth16 proof, binds its eight signals to the release, marks the statement spent and advances the policy counter. | No. |
| `groth16_verifier` | BN254 Groth16 verification, with the verifying key embedded in code ([groth16-on-soroban.md](../decisions/groth16-on-soroban.md)). | No. |
| `policy_registry` | Each poster's policy commitment and daily spend counter, and their buyer list root. | No. |
| `screening_registry` | Screenings signed by registered screeners, which the hook reads at funding and at release. | No. |

`square_job` never reads a live token balance to decide a payout. Every
amount it moves is computed from the stored budget and the fee basis points
snapshotted at funding.

## Where state lives

Soroban has three storage kinds. The contracts use two of them.

- **Instance storage** holds each contract's configuration and counters:
  the references fixed at construction, the fee settings, the totals, and the
  owner. It lives and dies with the contract instance.
- **Persistent storage** holds everything keyed by a job, a dispute, an
  account or a statement.
- **Temporary storage** is not used. An archived temporary entry is deleted,
  and nothing whose loss would change an outcome may be deleted
  ([fees-and-ttl.md](../decisions/fees-and-ttl.md#principles), principle 1).

Every persistent key belongs to one TTL class. The class decides how long the
key is kept alive and who pays for it.

| Class | Keys | Helper in `square_common::ttl` |
|---|---|---|
| J: job-scoped | everything keyed by a job | `bump_job(env, cfg, key, &job)` |
| D: dispute-scoped | per-dispute keys | `bump_dispute(env, cfg, key, &job, resolve_by)` |
| U: until a timestamp | keys whose meaning ends at a known time | `extend_until(env, cfg, key, end)` |
| G: global configuration | sets and settings the owner writes | `extend_config(env, cfg, key)`, then the keeper's sweep |

The owner, a pending ownership offer and the `TtlConfig` live in instance
storage under `Symbol` keys (`owner`, `pending`, `ttl_cfg`). They cannot
collide with a contract's own keys, which are `#[contracttype]` enums and
encode as vectors. The contract keys are in [Storage keys](#storage-keys),
generated from `square_common::keys`.

### `square_job`

A job is one persistent `JobRecord` under `SquareJobKey::Job(job_id)`.

| Field | Type | Meaning |
|---|---|---|
| `client` | `Address` | The creator. Receives refunds. |
| `created_at` | `u64` | The ledger time at `create_job`. |
| `expired_at` | `u64` | The client's deadline. `claim_refund` opens here. |
| `provider` | `Option<Address>` | Unset until `set_provider` when the client leaves it open. |
| `funded_at` | `u64` | 0 until Funded. |
| `submitted_at` | `u64` | 0 until Submitted. The challenge window counts from here. |
| `evaluator` | `Address` | Always set: ERC-8183 refuses a zero evaluator. |
| `budget` | `u64` | The escrowed amount. |
| `status` | `JobStatus` | ERC-8183's six statuses, in ERC-8183's order. |
| `hook` | `Option<Address>` | `None` means no hook. Otherwise it must be whitelisted at creation. |
| `platform_fee_bp`, `evaluator_fee_bp` | `u32` | Snapshotted at `fund`. |
| `provider_bps` | `u32` | The share of the net that went to the provider side at `complete`. |
| `hook_resolves_payout` | `bool` | The hook answered `supports("IPayoutResolver")` at creation. |
| `payee` | `Option<Address>` | Who received the provider-side share at `complete`. |
| `deliverable` | `BytesN<32>` | Set at `submit`. |
| `description` | `String` | Set at creation. ERC-8183 tooling reads it back. |
| `settlement_horizon` | `u64` | The evaluator's horizon, snapshotted at creation. |
| `commitment_at_fund` | `Option<BytesN<32>>` | The policy commitment the hook pinned at `fund` ([call-graph-on-soroban.md](../decisions/call-graph-on-soroban.md#1-push-model-hookcontext)). |

- **Status.** `JobStatus` is `Open, Funded, Submitted, Completed, Rejected,
  Expired`.
  - A dispute does not change `status`. While a dispute is open, the job
    stays `Submitted` and the evaluator does not complete it.
  - Dispute state lives in `keeper_evaluator` and `arbitration`.
- **The fee snapshot.** The fee basis points are contract-wide settings.
  - If they were read at `complete`, a change between funding and completion
    would change what the provider is paid and what a receivable is worth.
  - Snapshotting them at `fund` fixes the net payout when the money enters
    escrow. That is the amount the claim market prices and the compliance
    proof binds to.
- **Solvency.** The kernel's USDC balance always covers everything it owes.
  The test suite checks this after every operation:

  ```text
  usdc.balance(square_job) ≥ total_escrowed + total_withdrawable
  ```

- **Pull payments.** Nothing is pushed.
  - `complete`, `reject` and `claim_refund` credit a ledger
    (`SquareJobKey::Withdrawable(account)`), and the holder calls
    `withdraw_to(account, to, amount)`.
  - The reason is a Stellar one. A transfer to a `G…` account fails when the
    account has no USDC trustline (`TrustlineMissingError`, #13) or when the
    issuer has deauthorized it (`BalanceDeauthorizedError`, #11).
  - With a push, one such provider would make `complete` fail forever.
    With a ledger, a credit cannot fail, and the holder chooses where the
    money goes.
  - The ERC-8183 events fire at the credit, because the credit is the
    settlement decision. `Withdrawn` records the transfer.
- **Payout routing.** At `complete`, the net amount
  (`budget − platform fee − evaluator fee`) is split:

  ```text
  provider_share = net × provider_bps / 10 000   → credited to the payee
  client_share   = net − provider_share          → credited to the client
  ```

  - The payee and `provider_bps` come from the hook's `resolve_payout`.
  - Without a hook, or with a hook that does not resolve payouts,
    `payee = provider` and `provider_bps = 10 000`.
  - The kernel validates both answers, so the hook cannot create or destroy
    value. It can only say who receives the provider-side share and how
    large it is.
  - That is how a sold receivable pays its buyer and how an arbitration split
    is expressed, without a third terminal state.

### The other contracts

- **`keeper_evaluator`: windows are versioned by time, not overwritten.**
  - A job uses the window in force at its `submitted_at`.
  - An owner therefore cannot shorten the window of a job that is already in
    it.
- **`arbitration`: votes are cast on a resolution.**
  - A vote is recorded against `resolution_hash(job_id, outcome,
    provider_bps)`, and the first resolution whose bitmask reaches the
    threshold decides.
  - An arbiter votes at most once per dispute, so one address cannot back
    two competing resolutions.
  - Rotating the arbiter set creates a new version. Open disputes keep the
    version they were opened under.
- **`claim_market`: one listing per job.**
  - A cancelled listing may be replaced; a sold one is final.
  - `payee_of(job_id, provider)` returns the buyer when the listing is sold,
    and the provider it was given otherwise.
  - `buy` checks the buyer's salted leaf against the client's buyer root in
    `policy_registry`. Nothing about the list is stored in the market.
- **`policy_registry`: keyed by the poster, never by a job.**
  - The daily counter resets lazily: a stored `day` that is not today reads
    as zero.
  - It is a calendar day, not a rolling window
    ([public-daily-ceiling.md](../decisions/public-daily-ceiling.md)).
- **`screening_registry`: keyed by the subject.** `is_cleared(subject)` is
  true only for a record that:
  - exists and is not sanctioned;
  - is younger than `max_age`;
  - was submitted by a screener that is still registered.

  An empty registry clears nobody.

## Error codes

**Each contract has one `#[contracterror]` enum.**

- **Codes.** Codes start at 1, in the order the EVM contract declares its
  custom errors, and every name is the EVM name.
- **Stability.** Codes are stable. A code is never renumbered or reused, and
  a new error takes the next free number.
- **Shared codes.** The owner's codes start at 900 and the TTL config's at
  910, so they never meet a contract's own.
- **The JSON.** `contracts/common/errors.json` holds, for each contract crate,
  every code it can raise: its own enum, plus the owner and TTL codes when
  the contract has an owner or stores a `TtlConfig`.

**Reading a failure.**

- **Where the code comes from.** A failed call reports
  `Error(Contract, #n)`. The host logs an `error` diagnostic event from the
  frame that raised it and from each frame it passed through, so the first
  such event names the contract where the code comes from.
- **The failing contract may not be the called one.** A code can come from a
  contract the called one used: the kernel's `fund` fails with the hook's
  code when the hook refuses the client.
- **Reading the name.** `@squaresdk/core` reads the contract from the
  diagnostics and then the name from its table
  (`packages/core/src/stellar/errors.ts`).

**EVM errors with no Soroban code.** These are declared by the EVM contracts
or the OpenZeppelin bases they inherit. The failure each one reported is
reported on Soroban by the host, or cannot happen.

| EVM error | Contracts | On Soroban |
|---|---|---|
| `OwnableUnauthorizedAccount` | every owned contract | The owner's `require_auth()` fails in the host: `Error(Auth, InvalidAction)`. |
| `OwnableInvalidOwner` | every owned contract | Unreachable. There is no zero address, and the owner is set once, from the constructor. |
| `ReentrancyGuardReentrantCall` | `SquareJob`, `KeeperEvaluator`, `Arbitration`, `ClaimMarket` | The host refuses re-entry into a contract already on the stack: `Error(Context, InvalidAction)` ([call-graph-on-soroban.md](../decisions/call-graph-on-soroban.md)). |
| `SafeERC20FailedOperation` | `SquareJob`, `Arbitration`, `ClaimMarket` | A failed SAC `transfer` fails the call with the SAC's own error, for example `TrustlineMissingError` (#13) or `BalanceError` (#10). |
| `HookGasLimitTooLow` | `ComplianceModule` | Unreachable. Soroban has no per-call gas limit to configure: the whole transaction shares one budget. |
| `ECDSAInvalidSignature`, `ECDSAInvalidSignatureLength`, `ECDSAInvalidSignatureS` | `ScreeningRegistry` | Unreachable. A screening is authorized by the screener's `require_auth()`, which the host verifies, not by an EIP-712 signature the contract recovers. |
| `InvalidShortString`, `StringTooLong` | `ScreeningRegistry` | Unreachable. They belonged to OpenZeppelin's EIP-712 domain, which is not ported. |

<!-- generated:errors -->
#### `square_job`: `SquareJobError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `InvalidJob` | `SquareJob.InvalidJob` |
| 2 | `WrongStatus` | `SquareJob.WrongStatus` |
| 3 | `Unauthorized` | `SquareJob.Unauthorized` |
| 4 | `ZeroAddress` | `SquareJob.ZeroAddress` |
| 5 | `ExpiryInPast` | `SquareJob.ExpiryInPast` |
| 6 | `ExpiryTooLarge` | `SquareJob.ExpiryTooLarge` |
| 7 | `ExpiryTooShort` | `SquareJob.ExpiryTooShort` |
| 8 | `PastExpiry` | `SquareJob.PastExpiry` |
| 9 | `NotExpired` | `SquareJob.NotExpired` |
| 10 | `ZeroBudget` | `SquareJob.ZeroBudget` |
| 11 | `BudgetTooLarge` | `SquareJob.BudgetTooLarge` |
| 12 | `BudgetMismatch` | `SquareJob.BudgetMismatch` |
| 13 | `ProviderNotSet` | `SquareJob.ProviderNotSet` |
| 14 | `ProviderAlreadySet` | `SquareJob.ProviderAlreadySet` |
| 15 | `FeesTooHigh` | `SquareJob.FeesTooHigh` |
| 16 | `NothingToSkim` | `SquareJob.NothingToSkim` |
| 17 | `ComplianceProofTooLarge` | `SquareJob.ComplianceProofTooLarge` |
| 18 | `HookNotWhitelisted` | `SquareJob.HookNotWhitelisted` |
| 19 | `InvalidHook` | `SquareJob.InvalidHook` |
| 20 | `HookReverted` | `SquareJob.HookReverted` |
| 21 | `InvalidPayee` | `SquareJob.InvalidPayee` |
| 22 | `InvalidSplit` | `SquareJob.InvalidSplit` |
| 23 | `InsufficientBalance` | `SquareJob.InsufficientBalance` |
| 24 | `DescriptionTooLong` | `SquareJob.DescriptionTooLong` |
| 25 | `SettledByEvaluator` | `SquareJob.SettledByEvaluator` |
| 26 | `ProviderIsEvaluator` | `SquareJob.ProviderIsEvaluator` |

#### `keeper_evaluator`: `KeeperEvaluatorError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `ZeroAddress` | `KeeperEvaluator.ZeroAddress` |
| 2 | `ZeroWindow` | `KeeperEvaluator.ZeroWindow` |
| 3 | `NotOurJob` | `KeeperEvaluator.NotOurJob` |
| 4 | `NotSubmitted` | `KeeperEvaluator.NotSubmitted` |
| 5 | `WindowOpen` | `KeeperEvaluator.WindowOpen` |
| 6 | `WindowClosed` | `KeeperEvaluator.WindowClosed` |
| 7 | `Disputed` | `KeeperEvaluator.Disputed` |
| 8 | `NotDisputed` | `KeeperEvaluator.NotDisputed` |
| 9 | `AlreadyResolved` | `KeeperEvaluator.AlreadyResolved` |
| 10 | `NotDecided` | `KeeperEvaluator.NotDecided` |
| 11 | `OnlyClient` | `KeeperEvaluator.OnlyClient` |
| 12 | `OnlyArbitration` | `KeeperEvaluator.OnlyArbitration` |
| 13 | `ArbitrationAlreadySet` | `KeeperEvaluator.ArbitrationAlreadySet` |
| 14 | `ArbitrationNotSet` | `KeeperEvaluator.ArbitrationNotSet` |
| 15 | `SplitNeedsAPayoutResolver` | `KeeperEvaluator.SplitNeedsAPayoutResolver` |
| 16 | `ProofRequired` | `KeeperEvaluator.ProofRequired` |

#### `arbitration`: `ArbitrationError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `ZeroAddress` | `Arbitration.ZeroAddress` |
| 2 | `OnlyKeeperEvaluator` | `Arbitration.OnlyKeeperEvaluator` |
| 3 | `NoArbiters` | `Arbitration.NoArbiters` |
| 4 | `BadArbiterSet` | `Arbitration.BadArbiterSet` |
| 5 | `BadBondParameters` | `Arbitration.BadBondParameters` |
| 6 | `DisputeExists` | `Arbitration.DisputeExists` |
| 7 | `UnknownDispute` | `Arbitration.UnknownDispute` |
| 8 | `AlreadyDecided` | `Arbitration.AlreadyDecided` |
| 9 | `NotAnArbiter` | `Arbitration.NotAnArbiter` |
| 10 | `AlreadyVoted` | `Arbitration.AlreadyVoted` |
| 11 | `BadResolution` | `Arbitration.BadResolution` |
| 12 | `NotLapsed` | `Arbitration.NotLapsed` |
| 13 | `NothingToSettle` | `Arbitration.NothingToSettle` |
| 14 | `InsufficientBalance` | `Arbitration.InsufficientBalance` |
| 15 | `SplitNeedsAPayoutResolver` | `Arbitration.SplitNeedsAPayoutResolver` |
| 16 | `JobNoLongerVotable` | `Arbitration.JobNoLongerVotable` |

#### `claim_market`: `ClaimMarketError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `NotSubmitted` | `ClaimMarket.NotSubmitted` |
| 2 | `NotOptimisticJob` | `ClaimMarket.NotOptimisticJob` |
| 3 | `OnlyProvider` | `ClaimMarket.OnlyProvider` |
| 4 | `OnlySeller` | `ClaimMarket.OnlySeller` |
| 5 | `Disputed` | `ClaimMarket.Disputed` |
| 6 | `ListingActive` | `ClaimMarket.ListingActive` |
| 7 | `NotListed` | `ClaimMarket.NotListed` |
| 8 | `BadPrice` | `ClaimMarket.BadPrice` |
| 9 | `BuyerIsSeller` | `ClaimMarket.BuyerIsSeller` |
| 10 | `BuyerIsClient` | `ClaimMarket.BuyerIsClient` |
| 11 | `PayoutNotRouted` | `ClaimMarket.PayoutNotRouted` |
| 12 | `PriceMismatch` | `ClaimMarket.PriceMismatch` |
| 13 | `BuyerNotEligible` | `ClaimMarket.BuyerNotEligible` |

#### `square_hook`: `SquareHookError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `OnlyKernel` | `SquareHook.OnlyKernel` |
| 2 | `AgentNotOwnedByProvider` | `SquareHook.AgentNotOwnedByProvider` |
| 3 | `ValidationRequestMismatch` | `SquareHook.ValidationRequestMismatch` |
| 4 | `NotExpired` | `SquareHook.NotExpired` |
| 5 | `NoPolicy` | `SquareHook.NoPolicy` |
| 6 | `AlreadyRecorded` | `SquareHook.AlreadyRecorded` |
| 7 | `NoAgentBound` | `SquareHook.NoAgentBound` |
| 8 | `NotCleared` | `SquareHook.NotCleared` |

#### `compliance_module`: `ComplianceModuleError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `OnlyHook` | `ComplianceModule.OnlyHook` |
| 2 | `ProofDoesNotVerify` | `ComplianceModule.ProofDoesNotVerify` |
| 3 | `ZeroAddress` | `ComplianceModule.ZeroAddress` |

#### `policy_registry`: `PolicyRegistryError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `ZeroCommitment` | `PolicyRegistry.ZeroCommitment` |
| 2 | `ZeroAddress` | `PolicyRegistry.ZeroAddress` |
| 3 | `NotASpender` | `PolicyRegistry.NotASpender` |
| 4 | `LimitExceedsProofRange` | `PolicyRegistry.LimitExceedsProofRange` |
| 5 | `CommitmentOutsideProofRange` | `PolicyRegistry.CommitmentOutsideProofRange` |
| 6 | `RenounceDisabled` | `PolicyRegistry.RenounceDisabled` |
| 7 | `SpendOverflow` | `PolicyRegistry.SpendOverflow` |

#### `screening_registry`: `ScreeningRegistryError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `ZeroAddress` | `ScreeningRegistry.ZeroAddress` |
| 2 | `NotAScreener` | `ScreeningRegistry.NotAScreener` |
| 3 | `ScreenedInTheFuture` | `ScreeningRegistry.ScreenedInTheFuture` |
| 4 | `ScreeningTooOld` | `ScreeningRegistry.ScreeningTooOld` |
| 5 | `NotNewerThanRecorded` | `ScreeningRegistry.NotNewerThanRecorded` |
| 6 | `MaxAgeOutOfRange` | `ScreeningRegistry.MaxAgeOutOfRange` |
| 7 | `LengthMismatch` | `ScreeningRegistry.LengthMismatch` |
| 8 | `RenounceDisabled` | `ScreeningRegistry.RenounceDisabled` |

#### `groth16_verifier`: `Groth16VerifierError`

| Code | Name | EVM |
|---:|---|---|
| 1 | `ProofLength` | new on Soroban (`Groth16Verifier.sol` declares no errors) |
| 2 | `KeyLength` | new on Soroban (`Groth16Verifier.sol` declares no errors) |

#### Shared: `OwnerError` (every contract with an owner) and `TtlError` (every contract that stores a `TtlConfig`)

| Code | Name | Raised by |
|---:|---|---|
| 900 | `OwnerNotSet` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 901 | `OwnerAlreadySet` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 902 | `NoPendingTransfer` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 903 | `TransferExpired` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 904 | `TransferInProgress` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 905 | `RenounceDisabled` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 906 | `ExpiryInPast` | `owner`: `square_job`, `keeper_evaluator`, `arbitration`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 910 | `ConfigMissing` | `ttl`: `square_job`, `keeper_evaluator`, `arbitration`, `claim_market`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
| 911 | `InvalidConfig` | `ttl`: `square_job`, `keeper_evaluator`, `arbitration`, `claim_market`, `square_hook`, `compliance_module`, `policy_registry`, `screening_registry` |
<!-- /generated:errors -->

## Events

**The rule, for every event.**

- `topics[0]` is the event's name as a `Symbol`, in snake case: `JobCreated`
  publishes `job_created`.
- `topics[1..]` are the fields the EVM event marked `indexed`, in order, so
  no event has more than four topics.
- `data` is a map of the remaining fields, keyed by field name. A new field
  can therefore be added without moving the others.
- The event names are the EVM names, so an indexer that knew the EVM schema
  finds each event under the same name.

**Types follow one mapping:**

| EVM | Soroban |
|---|---|
| `uint256 jobId` | `u64 job_id` |
| `uint256` token amount | `i128`, the SAC's type |
| `uint64`, `uint128` amount | kept: `u64`, `u128` |
| `uint48` time | `u64` |
| `uint16`, `uint8` number | `u32` |
| `uint8` code (`outcome`, a check outcome) | a `#[contracttype]` enum: `Outcome`, `ReputationOutcome`, `CheckOutcome` |
| `bytes32` short string (a `reason`) | a `Symbol` of the same text with spaces as underscores (`"malformed proof"` → `malformed_proof`), since a `Symbol` holds `[a-zA-Z0-9_]` only; `RefusalReason` and `SkipReason` list them |
| `address` that may be zero | `Option<Address>` |
| `bytes32` whose zero meant "none" | `Option<BytesN<32>>` |
| `bytes` revert data of a caught call | `Option<Error>`: the error the call handed back, or `None` when the callee returned the wrong type |
| `bytes4` selector | `Symbol`: the function's name |

**Each contract publishes only its own events.** The definitions sit in one
shared crate, but each contract's spec, and so its bindings, lists only the
events it publishes.

- The workspace builds with the SDK's `experimental_spec_shaking_v2`, which
  marks what a contract uses at its boundary.
- `stellar contract build` then strips the other definitions from the Wasm's
  spec.

**Two account-keyed money events that a `job_id` filter cannot see:**

| Event | Contract | Keyed by |
|---|---|---|
| `Withdrawn` | `square_job` | `account` |
| `BondWithdrawn` | `arbitration` | `account` |

The pull-payment ledger and the bond ledger are keyed by the account paid,
not by the job the money came from, and neither event carries a `job_id`. An
indexer built on `job_id` alone would see every credit and no debit. The
indexer takes both through the account, and anything else reading these
events has to do the same.

**Events with no job to name.** These are configuration and administration
events:

| Contract | Events |
|---|---|
| `square_job` | `FeesUpdated`, `FeesScheduled`, `Skimmed`, `HookWhitelistUpdated` |
| `keeper_evaluator` | `ArbitrationSet`, `WindowsConfigured`, `FinalizeGraceConfigured` |
| `arbitration` | `ArbitersUpdated`, `BondParametersUpdated` |
| `square_hook` | `ComplianceModuleUpdated`, `ScreeningUpdated`, `ReputationPolicyUpdated`, `RegistryWritesUpdated` |
| `compliance_module` | `HookUpdated`, `TimestampToleranceUpdated` |
| `screening_registry` | `ScreenerUpdated`, `MaxAgeUpdated` |
| every contract with an owner | the ownership events |
| every contract that stores a `TtlConfig` | `TtlConfigUpdated` |

`policy_registry` is keyed by the poster throughout and has no job anywhere.

**Not ported.** `ScreeningRegistry`'s `EIP712DomainChanged`, declared by
OpenZeppelin's `EIP712` for ERC-5267 and never emitted, has no counterpart.
A screening is authorized with the screener's `require_auth()`, so there is
no signing domain to announce.

**An event that should never fire needs a consumer.** These events all mean
"the design tolerated something it did not want":

- `HookFailed`
- `PayoutUnresolvable`
- `ReputationWriteFailed`
- `ValidationWriteFailed`
- `ComplianceCheckFailed`
- `ReleaseUnconfirmed`
- `EvidenceUnreadable`
- `RejectionNotApplied`

A tolerated failure that nobody reads is an unobserved one. So the change that
adds such an event adds its reader in the same change: a reducer branch, a
metric or a mirror column, and, where it warrants attention, an alert rule.

<!-- generated:events -->
#### `square_job`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `JobCreated` | `job_id: u64`, `client: Address`, `provider: Option<Address>` | `evaluator: Address`, `expired_at: u64`, `hook: Option<Address>` | A job was created, Open. |
| `ProviderSet` | `job_id: u64`, `provider: Address` | — | The provider was filled in. |
| `BudgetSet` | `job_id: u64` | `amount: i128` | The price was agreed. |
| `JobFunded` | `job_id: u64`, `client: Address` | `amount: i128` | The budget moved into escrow: Funded. |
| `JobSubmitted` | `job_id: u64`, `provider: Address` | `deliverable: BytesN<32>` | The provider submitted: Submitted. |
| `JobCompleted` | `job_id: u64`, `evaluator: Address` | `reason: BytesN<32>` | The evaluator completed the job: Completed. |
| `JobRejected` | `job_id: u64`, `rejector: Address` | `reason: BytesN<32>` | The client (while Open) or the evaluator rejected the job: Rejected. |
| `JobExpired` | `job_id: u64` | — | `claim_refund` after expiry: Expired. |
| `PaymentReleased` | `job_id: u64`, `provider: Address` | `amount: i128` | The provider-side share was credited. `provider` is the payee, which is the buyer when the receivable was sold. |
| `EvaluatorFeePaid` | `job_id: u64`, `evaluator: Address` | `amount: i128` | The evaluator fee was credited. |
| `Refunded` | `job_id: u64`, `client: Address` | `amount: i128` | The client was credited: its share of a split, a rejection or an expiry. |
| `HookWhitelistUpdated` | `hook: Option<Address>` | `status: bool` | The owner admitted or removed a hook. `None` is "no hook", which is whitelisted at construction as the EVM kernel whitelisted `address(0)`. |
| `JobDescribed` | `job_id: u64` | `created_at: u64`, `description: String` | The description and creation time, beside `JobCreated`. |
| `FeesSnapshotted` | `job_id: u64` | `platform_fee_bp: u32`, `evaluator_fee_bp: u32`, `funded_at: u64` | The fee basis points the payout will use, snapshotted at `fund`. |
| `SubmissionTimed` | `job_id: u64` | `submitted_at: u64`, `expired_at: u64` | The time the challenge window counts from. |
| `PayoutRouted` | `job_id: u64`, `payee: Address` | `provider_bps: u32`, `provider_share: i128`, `client_share: i128` | The routing decision at `complete`: who receives the provider-side share, and how the net payout was split. |
| `PlatformFeeAccrued` | `job_id: u64`, `treasury: Address` | `amount: i128` | The platform fee was credited to the treasury. |
| `Withdrawn` | `account: Address`, `to: Address` | `amount: i128` | A ledger debit: the balance holder moved `amount` out to `to`. Keyed by account, not by job. |
| `FeesUpdated` | — | `platform_fee_bp: u32`, `evaluator_fee_bp: u32`, `treasury: Address` | The fee basis points in force and the treasury, after `set_fees` or once a scheduled change took effect. |
| `FeesScheduled` | — | `platform_fee_bp: u32`, `evaluator_fee_bp: u32`, `effective_from: u64` | New fee basis points a later `fund` pins once `effective_from` passes. |
| `Skimmed` | `to: Address` | `amount: i128` | A balance no ledger entry and no escrow claimed, moved out by the owner. |
| `ComplianceProofSet` | `job_id: u64`, `client: Address` | `digest: BytesN<32>` | The client bound a compliance proof; `digest` is its keccak256, so the event carries no witness. |
| `HookFailed` | `job_id: u64`, `hook: Address` | `action: Symbol`, `hook_fn: Symbol`, `error: Option<Error>` | A tolerant hook call failed and the transition went ahead. `action` is the kernel function that was running (`complete`, `reject`), `hook_fn` the hook entry point (`before_action`, `after_action`), `error` the error the call handed back, or `None` when the hook returned the wrong type. |
| `PayoutUnresolvable` | `job_id: u64`, `hook: Address` | — | `claim_refund` on a Submitted job whose hook can no longer name a usable payee: the refund proceeds. |

```text
JobCreated
  topic  {"symbol":"job_created"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   evaluator   {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"}
         expired_at  {"u64":"1789604800"}
         hook        {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"}
ProviderSet
  topic  {"symbol":"provider_set"}
  topic  {"u64":"1"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   {"map":[]}
BudgetSet
  topic  {"symbol":"budget_set"}
  topic  {"u64":"1"}
  data   amount  {"i128":"50000000"}
JobFunded
  topic  {"symbol":"job_funded"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   amount  {"i128":"50000000"}
JobSubmitted
  topic  {"symbol":"job_submitted"}
  topic  {"u64":"1"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   deliverable  {"bytes":"121a92d0991a640d403f455df1a0bf17b044f7a7083309b93f9ef083312d9370"}
JobCompleted
  topic  {"symbol":"job_completed"}
  topic  {"u64":"1"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"}
  data   reason  {"bytes":"6ea580244991108779fcdb7a580c34ff808189cae286a18b77718bbf596316b2"}
JobRejected
  topic  {"symbol":"job_rejected"}
  topic  {"u64":"1"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"}
  data   reason  {"bytes":"b89558284e3c27db6e29f25a162cfdc15db8b4cc7285634b432d489e2667f9e3"}
JobExpired
  topic  {"symbol":"job_expired"}
  topic  {"u64":"1"}
  data   {"map":[]}
PaymentReleased
  topic  {"symbol":"payment_released"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   amount  {"i128":"49250000"}
EvaluatorFeePaid
  topic  {"symbol":"evaluator_fee_paid"}
  topic  {"u64":"1"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"}
  data   amount  {"i128":"250000"}
Refunded
  topic  {"symbol":"refunded"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   amount  {"i128":"50000000"}
HookWhitelistUpdated
  topic  {"symbol":"hook_whitelist_updated"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"}
  data   status  {"bool":true}
JobDescribed
  topic  {"symbol":"job_described"}
  topic  {"u64":"1"}
  data   created_at   {"u64":"1789000000"}
         description  {"string":"Summarise the Q3 filing"}
FeesSnapshotted
  topic  {"symbol":"fees_snapshotted"}
  topic  {"u64":"1"}
  data   evaluator_fee_bp  {"u32":50}
         funded_at         {"u64":"1789000060"}
         platform_fee_bp   {"u32":100}
SubmissionTimed
  topic  {"symbol":"submission_timed"}
  topic  {"u64":"1"}
  data   expired_at    {"u64":"1789604800"}
         submitted_at  {"u64":"1789003600"}
PayoutRouted
  topic  {"symbol":"payout_routed"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   client_share    {"i128":"0"}
         provider_bps    {"u32":10000}
         provider_share  {"i128":"49250000"}
PlatformFeeAccrued
  topic  {"symbol":"platform_fee_accrued"}
  topic  {"u64":"1"}
  topic  {"address":"GBUYPFRIRYXNCYVP4TLCDRAW37VJFXQ3WDWQV3N66MZVE5P3C2JQ2V5F"}
  data   amount  {"i128":"500000"}
Withdrawn
  topic  {"symbol":"withdrawn"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   amount  {"i128":"49250000"}
FeesUpdated
  topic  {"symbol":"fees_updated"}
  data   evaluator_fee_bp  {"u32":50}
         platform_fee_bp   {"u32":100}
         treasury          {"address":"GBUYPFRIRYXNCYVP4TLCDRAW37VJFXQ3WDWQV3N66MZVE5P3C2JQ2V5F"}
FeesScheduled
  topic  {"symbol":"fees_scheduled"}
  data   effective_from    {"u64":"1789086400"}
         evaluator_fee_bp  {"u32":50}
         platform_fee_bp   {"u32":150}
Skimmed
  topic  {"symbol":"skimmed"}
  topic  {"address":"GBUYPFRIRYXNCYVP4TLCDRAW37VJFXQ3WDWQV3N66MZVE5P3C2JQ2V5F"}
  data   amount  {"i128":"1000000"}
ComplianceProofSet
  topic  {"symbol":"compliance_proof_set"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   digest  {"bytes":"8a3972bab4d1ef337498e280bcb5d8258d790eab67bdc5c942889c6730392222"}
HookFailed
  topic  {"symbol":"hook_failed"}
  topic  {"u64":"1"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"}
  data   action   {"symbol":"complete"}
         error    {"error":{"contract":3}}
         hook_fn  {"symbol":"after_action"}
PayoutUnresolvable
  topic  {"symbol":"payout_unresolvable"}
  topic  {"u64":"1"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"}
  data   {"map":[]}
```

#### `keeper_evaluator`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `WindowsConfigured` | — | `effective_from: u64`, `challenge_window: u64`, `dispute_window: u64` | A new window entry, in force from `effective_from`. |
| `FinalizeGraceConfigured` | — | `finalize_grace: u64` | The finalize grace of the entry `WindowsConfigured` just announced; both are published on every window push. |
| `ArbitrationSet` | `arbitration: Address` | — | The arbitration contract this evaluator trusts, set exactly once. |
| `Finalized` | `job_id: u64`, `keeper: Address` | `keeper_fee: i128` | Optimistic completion, and who was paid for calling it. |
| `DisputeRaised` | `job_id: u64`, `disputer: Address` | `disputed_at: u64`, `challenge_end: u64` | The client disputed; finalize is closed for the job. |
| `DecisionApplied` | `job_id: u64`, `keeper: Address` | `outcome: Outcome`, `provider_bps: u32`, `keeper_fee: i128` | An arbitration decision settled on the kernel. |

```text
WindowsConfigured
  topic  {"symbol":"windows_configured"}
  data   challenge_window  {"u64":"120"}
         dispute_window    {"u64":"300"}
         effective_from    {"u64":"1789000000"}
FinalizeGraceConfigured
  topic  {"symbol":"finalize_grace_configured"}
  data   finalize_grace  {"u64":"600"}
ArbitrationSet
  topic  {"symbol":"arbitration_set"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4"}
  data   {"map":[]}
Finalized
  topic  {"symbol":"finalized"}
  topic  {"u64":"1"}
  topic  {"address":"GBW3PHK4HGDOZIA22EM4LVQHP4HRSUIGTQT36YTCGBVWJKPZPPFQBS6P"}
  data   keeper_fee  {"i128":"250000"}
DisputeRaised
  topic  {"symbol":"dispute_raised"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   challenge_end  {"u64":"1789003720"}
         disputed_at    {"u64":"1789003660"}
DecisionApplied
  topic  {"symbol":"decision_applied"}
  topic  {"u64":"1"}
  topic  {"address":"GBW3PHK4HGDOZIA22EM4LVQHP4HRSUIGTQT36YTCGBVWJKPZPPFQBS6P"}
  data   keeper_fee    {"i128":"250000"}
         outcome       {"vec":[{"symbol":"Complete"}]}
         provider_bps  {"u32":10000}
```

#### `arbitration`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `ArbitersUpdated` | `version: u32` | `arbiters: Vec<Address>`, `threshold: u32` | A new arbiter set, in full, so the indexer can map vote bits to addresses. |
| `BondParametersUpdated` | — | `bond_bps: u32`, `min_bond: u64` | Bond parameters for disputes opened from now on. |
| `DisputeOpened` | `job_id: u64`, `disputer: Address` | `bond: u64`, `disputed_at: u64`, `set_version: u32`, `resolve_by: u64` | A dispute opened and its bond was pulled from the disputer. |
| `VoteCast` | `job_id: u64`, `arbiter: Address`, `resolution_hash: BytesN<32>` | `outcome: Outcome`, `provider_bps: u32`, `approvals: U256` | An arbiter voted; `approvals` is the running bitmask for that resolution. |
| `DecisionReached` | `job_id: u64` | `outcome: Outcome`, `provider_bps: u32`, `resolution_hash: BytesN<32>` | The threshold was met. |
| `DisputeExpired` | `job_id: u64` | — | No decision by `resolve_by`: the dispute lapses to the optimistic outcome. |
| `BondSettled` | `job_id: u64`, `to: Address` | `amount: u64` | The bond was credited to whoever won it. |
| `BondWithdrawn` | `account: Address`, `to: Address` | `amount: i128` | A bond ledger debit. Keyed by account, not by job. |
| `RejectionNotApplied` | `job_id: u64` | `error: Option<Error>` | The panel decided Reject and the kernel refused to apply it; the decision is still recorded. `error` is what the refused call handed back. |

```text
ArbitersUpdated
  topic  {"symbol":"arbiters_updated"}
  topic  {"u32":1}
  data   arbiters   {"vec":[{"address":"GAHL46VPBKTPDIKO5K624YIUDUSCHBB2YOTZKTNSNE7RW6OMRTCESUL5"}]}
         threshold  {"u32":1}
BondParametersUpdated
  topic  {"symbol":"bond_parameters_updated"}
  data   bond_bps  {"u32":1000}
         min_bond  {"u64":"10000000"}
DisputeOpened
  topic  {"symbol":"dispute_opened"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   bond         {"u64":"10000000"}
         disputed_at  {"u64":"1789003660"}
         resolve_by   {"u64":"1789003960"}
         set_version  {"u32":1}
VoteCast
  topic  {"symbol":"vote_cast"}
  topic  {"u64":"1"}
  topic  {"address":"GAHL46VPBKTPDIKO5K624YIUDUSCHBB2YOTZKTNSNE7RW6OMRTCESUL5"}
  topic  {"bytes":"b89558284e3c27db6e29f25a162cfdc15db8b4cc7285634b432d489e2667f9e3"}
  data   approvals     {"u256":"1"}
         outcome       {"vec":[{"symbol":"Complete"}]}
         provider_bps  {"u32":10000}
DecisionReached
  topic  {"symbol":"decision_reached"}
  topic  {"u64":"1"}
  data   outcome          {"vec":[{"symbol":"Complete"}]}
         provider_bps     {"u32":10000}
         resolution_hash  {"bytes":"b89558284e3c27db6e29f25a162cfdc15db8b4cc7285634b432d489e2667f9e3"}
DisputeExpired
  topic  {"symbol":"dispute_expired"}
  topic  {"u64":"1"}
  data   {"map":[]}
BondSettled
  topic  {"symbol":"bond_settled"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   amount  {"u64":"10000000"}
BondWithdrawn
  topic  {"symbol":"bond_withdrawn"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   amount  {"i128":"10000000"}
RejectionNotApplied
  topic  {"symbol":"rejection_not_applied"}
  topic  {"u64":"1"}
  data   error  {"error":{"contract":2}}
```

#### `claim_market`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `ClaimListed` | `job_id: u64`, `seller: Address` | `price: u64`, `face_value: u64` | The provider listed the job's receivable. |
| `ClaimBought` | `job_id: u64`, `buyer: Address`, `seller: Address` | `price: u64` | A buyer bought it; the job's payee is now the buyer. |
| `ClaimCancelled` | `job_id: u64`, `seller: Address` | — | The seller withdrew the listing. |

```text
ClaimListed
  topic  {"symbol":"claim_listed"}
  topic  {"u64":"1"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   face_value  {"u64":"49250000"}
         price       {"u64":"48000000"}
ClaimBought
  topic  {"symbol":"claim_bought"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   price  {"u64":"48000000"}
ClaimCancelled
  topic  {"symbol":"claim_cancelled"}
  topic  {"u64":"1"}
  topic  {"address":"GDDPCTH4L6OKHN6T4KZEN2SQ45IRIWQ266XMJFTZ6YEANX74XFPJ256K"}
  data   {"map":[]}
```

#### `square_hook`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `AgentBound` | `job_id: u64`, `agent_id: u32` | `validation_request_hash: Option<BytesN<32>>` | At `submit`: the job is bound to the provider's agent and, when one was given, its validation request. |
| `ComplianceChecked` | `job_id: u64`, `payee: Address` | `amount: i128`, `verified: bool` | At `complete`: whether the installed compliance module booked the release; `verified` is false while no module is installed. |
| `ReputationRecorded` | `job_id: u64`, `agent_id: u32` | `outcome: ReputationOutcome`, `value: i128` | Feedback written to the reputation registry for the provider's agent. |
| `ReputationWriteFailed` | `job_id: u64`, `agent_id: u32` | `error: Option<Error>` | The reputation registry failed; settlement was not rolled back. |
| `ValidationRecorded` | `job_id: u64`, `request_hash: BytesN<32>` | `response: u32` | The hook's validation response for the job's request: 100 when every installed check passed and the payee was paid, 0 otherwise. |
| `ValidationWriteFailed` | `job_id: u64`, `request_hash: BytesN<32>` | `error: Option<Error>` | The validation registry failed; settlement was not rolled back. |
| `ComplianceModuleUpdated` | `module: Option<Address>` | — | The owner installed, replaced or removed the compliance module. |
| `ScreeningUpdated` | `registry: Option<Address>` | — | The owner installed, replaced or removed the screening registry. |
| `ScreeningChecked` | `job_id: u64`, `payee: Address` | `cleared: bool` | At `complete`, with screening installed: whether the payee was cleared. |
| `ComplianceCheckFailed` | `job_id: u64` | `error: Option<Error>` | The compliance module failed while `before_action` checked the release; settlement continues and `ComplianceChecked` reports `verified = false`. |
| `ReputationPolicyUpdated` | `trusted_evaluator: Option<Address>` | `min_reputation_budget: u64` | Whose jobs earn positive reputation, and the budget below which none is written. |
| `ReputationSkipped` | `job_id: u64`, `agent_id: u32` | `reason: Symbol` | Positive feedback deliberately not written; no registry call was made. `reason` is a `SkipReason::text`: `untrusted_evaluator` or `budget_below_minimum`. |
| `ReleaseUnconfirmed` | `job_id: u64`, `payee: Address` | `amount: i128` | The kernel paid `amount` to `payee` on a preview that passed, and the check that books the release did not pass. |
| `PolicyPinned` | `job_id: u64`, `client: Address` | `commitment: BytesN<32>` | At `fund`, with a compliance module installed: the policy commitment every later proof for this job is checked against. |
| `EvidenceUnreadable` | `job_id: u64` | — | The settlement facts the evidence commits to were not in the context the kernel pushed, so no validation record is written. Settlement and the reputation write are untouched. |
| `EvidenceRecorded` | `job_id: u64`, `payee: Address` | `amount: i128`, `token: Address`, `screening: Option<BytesN<32>>`, `compliance_outcome: CheckOutcome`, `screening_outcome: CheckOutcome`, `commitment: BytesN<32>` | The preimage of the validation `response_hash`: anyone can recompute `commitment` with `square_common::hash::evidence_hash` and compare it with the registry's record. |
| `RegistryWritesUpdated` | — | `reputation: bool`, `validation: bool` | The owner switched the advisory registry writes on or off (docs/decisions/call-graph-on-soroban.md, decision 5). |

```text
AgentBound
  topic  {"symbol":"agent_bound"}
  topic  {"u64":"1"}
  topic  {"u32":0}
  data   validation_request_hash  {"bytes":"d94f866893559afdb9c3c4b72cbcbe46c5c612115fbcc0a1431c82297e6bd93c"}
ComplianceChecked
  topic  {"symbol":"compliance_checked"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   amount    {"i128":"49250000"}
         verified  {"bool":true}
ReputationRecorded
  topic  {"symbol":"reputation_recorded"}
  topic  {"u64":"1"}
  topic  {"u32":0}
  data   outcome  {"u32":1}
         value    {"i128":"1"}
ReputationWriteFailed
  topic  {"symbol":"reputation_write_failed"}
  topic  {"u64":"1"}
  topic  {"u32":0}
  data   error  "void"
ValidationRecorded
  topic  {"symbol":"validation_recorded"}
  topic  {"u64":"1"}
  topic  {"bytes":"d94f866893559afdb9c3c4b72cbcbe46c5c612115fbcc0a1431c82297e6bd93c"}
  data   response  {"u32":100}
ValidationWriteFailed
  topic  {"symbol":"validation_write_failed"}
  topic  {"u64":"1"}
  topic  {"bytes":"d94f866893559afdb9c3c4b72cbcbe46c5c612115fbcc0a1431c82297e6bd93c"}
  data   error  {"error":{"contract":1}}
ComplianceModuleUpdated
  topic  {"symbol":"compliance_module_updated"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4"}
  data   {"map":[]}
ScreeningUpdated
  topic  {"symbol":"screening_updated"}
  topic  "void"
  data   {"map":[]}
ScreeningChecked
  topic  {"symbol":"screening_checked"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   cleared  {"bool":true}
ComplianceCheckFailed
  topic  {"symbol":"compliance_check_failed"}
  topic  {"u64":"1"}
  data   error  {"error":{"contract":8}}
ReputationPolicyUpdated
  topic  {"symbol":"reputation_policy_updated"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"}
  data   min_reputation_budget  {"u64":"10000000"}
ReputationSkipped
  topic  {"symbol":"reputation_skipped"}
  topic  {"u64":"1"}
  topic  {"u32":0}
  data   reason  {"symbol":"budget_below_minimum"}
ReleaseUnconfirmed
  topic  {"symbol":"release_unconfirmed"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   amount  {"i128":"49250000"}
PolicyPinned
  topic  {"symbol":"policy_pinned"}
  topic  {"u64":"1"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  data   commitment  {"bytes":"00448c18e4fa9d09e17d9fbc4b154d4853ea1ad2bf0fe5751f6cc9a78f932d79"}
EvidenceUnreadable
  topic  {"symbol":"evidence_unreadable"}
  topic  {"u64":"1"}
  data   {"map":[]}
EvidenceRecorded
  topic  {"symbol":"evidence_recorded"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   amount              {"i128":"49250000"}
         commitment          {"bytes":"7043e41a24f9b7e8ba2a03dee26fb312a27cfe414c13fcf08c0055806feaf81a"}
         compliance_outcome  {"u32":1}
         screening           {"bytes":"269ca094a43a289cd009d4cd8ed4f87ecbecbac95d4ef5553e3b1e397a7d3347"}
         screening_outcome   {"u32":1}
         token               {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM"}
RegistryWritesUpdated
  topic  {"symbol":"registry_writes_updated"}
  data   reputation  {"bool":true}
         validation  {"bool":false}
```

#### `compliance_module`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `HookUpdated` | `hook: Address` | — | The hook whose `check_release` calls this module books. |
| `TimestampToleranceUpdated` | — | `seconds: u64` | How far a proof's timestamp may sit from the ledger's. |
| `ReleaseVerified` | `job_id: u64`, `payee: Address` | `amount: i128`, `statement: BytesN<32>` | A release the proof gated and the module booked: `statement` is spent from here on and the policy counter advanced by `amount`. |
| `VerdictDisagreed` | `job_id: u64` | `verdict: Verdict` | A proof that passed every binding and still came back `NoPolicy` or `LimitExceeded` from `policy_registry.record_spend`. |
| `ReleaseRefused` | `job_id: u64`, `statement: Option<BytesN<32>>` | `reason: Symbol` | A release the module refused, and why: `reason` is a `RefusalReason::text`, the EVM module's text with underscores (`malformed_proof`, `recipient`, `proof_already_used`, …). `statement` is `None` for the two refusals that come before any signal is read. |

```text
HookUpdated
  topic  {"symbol":"hook_updated"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"}
  data   {"map":[]}
TimestampToleranceUpdated
  topic  {"symbol":"timestamp_tolerance_updated"}
  data   seconds  {"u64":"600"}
ReleaseVerified
  topic  {"symbol":"release_verified"}
  topic  {"u64":"1"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  data   amount     {"i128":"49250000"}
         statement  {"bytes":"80e07e674520f2b850d820f0b8e20a6bec81c78a265b9df5bb6fd4d786f7533c"}
VerdictDisagreed
  topic  {"symbol":"verdict_disagreed"}
  topic  {"u64":"1"}
  data   verdict  {"vec":[{"symbol":"LimitExceeded"}]}
ReleaseRefused
  topic  {"symbol":"release_refused"}
  topic  {"u64":"1"}
  topic  {"bytes":"80e07e674520f2b850d820f0b8e20a6bec81c78a265b9df5bb6fd4d786f7533c"}
  data   reason  {"symbol":"recipient"}
```

#### `policy_registry`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `PolicyCommitted` | `poster: Address`, `commitment: BytesN<32>` | `daily_limit: u128`, `epoch: u64` | On every `set_policy`, including a replacement; `epoch` tells them apart. |
| `SpendRecorded` | `poster: Address`, `day: u64` | `amount: u128`, `spent_after: u128` | On every release booked, inside the policy or not; `day` is the UTC day index. |
| `ReleaseOutsidePolicy` | `poster: Address`, `day: u64` | `spent_after: u128`, `daily_limit: u128`, `verdict: Verdict` | Beside `SpendRecorded` when the verdict is not `Compliant`. The release still happened; this records that it happened outside the ceiling. |
| `SpenderUpdated` | `spender: Address` | `allowed: bool` | The owner added or removed a spender. |
| `BuyerRootCommitted` | `poster: Address`, `root: Option<BytesN<32>>` | — | On every `set_buyer_root`, including a replacement. `None` admits nobody; the list itself is never published, only its root. |

```text
PolicyCommitted
  topic  {"symbol":"policy_committed"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"bytes":"00448c18e4fa9d09e17d9fbc4b154d4853ea1ad2bf0fe5751f6cc9a78f932d79"}
  data   daily_limit  {"u128":"1000000000"}
         epoch        {"u64":"1"}
SpendRecorded
  topic  {"symbol":"spend_recorded"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"u64":"20706"}
  data   amount       {"u128":"49250000"}
         spent_after  {"u128":"49250000"}
ReleaseOutsidePolicy
  topic  {"symbol":"release_outside_policy"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"u64":"20706"}
  data   daily_limit  {"u128":"1000000000"}
         spent_after  {"u128":"1049250000"}
         verdict      {"vec":[{"symbol":"LimitExceeded"}]}
SpenderUpdated
  topic  {"symbol":"spender_updated"}
  topic  {"address":"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4"}
  data   allowed  {"bool":true}
BuyerRootCommitted
  topic  {"symbol":"buyer_root_committed"}
  topic  {"address":"GDGRA4MHPBVLJ475UZ3BDRVONJYT22VCHQXLISH45DRHSCXOQKKCJOE6"}
  topic  {"bytes":"ce9b8e800867849c8f6bdc9630d6d0a57a4e11d3c74b4d8a11ce340fce7fb3e5"}
  data   {"map":[]}
```

#### `screening_registry`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `Screened` | `subject: Address`, `source: BytesN<32>`, `screener: Address` | `sanctioned: bool`, `screened_at: u64`, `evidence: BytesN<32>` | An accepted screening; `evidence` is the hash of the source's raw response. |
| `ScreenerUpdated` | `screener: Address` | `allowed: bool` | The owner added or removed a screener; removing one also stops its records from clearing anyone. |
| `MaxAgeUpdated` | — | `max_age: u64` | How long a record clears its subject. |

```text
Screened
  topic  {"symbol":"screened"}
  topic  {"address":"GCJTGK24TVSGUJCTH4W3PGFDTWD647L5QYGK43DCIQMVMPFIQMXS4NFM"}
  topic  {"bytes":"659884cbd68ca5446f9619aec10553480afbec5253bcf87fcb733c9b71cdb375"}
  topic  {"address":"GA3AL7POFSG2RPCP7DRGLFO6EDQQFR6YARGUQU45Q6DIRRGGOWZ2BVDW"}
  data   evidence     {"bytes":"3a8c691923dbb98e1270bcf8dfa4f8173e140c2fa6921878f144c08c6ba80625"}
         sanctioned   {"bool":false}
         screened_at  {"u64":"1789000000"}
ScreenerUpdated
  topic  {"symbol":"screener_updated"}
  topic  {"address":"GA3AL7POFSG2RPCP7DRGLFO6EDQQFR6YARGUQU45Q6DIRRGGOWZ2BVDW"}
  data   allowed  {"bool":true}
MaxAgeUpdated
  topic  {"symbol":"max_age_updated"}
  data   max_age  {"u64":"86400"}
```

#### Every contract with an owner

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `OwnershipTransferStarted` | `owner: Address`, `pending_owner: Address` | `live_until_ledger: u32` | The owner offered ownership; nothing changes until `accept_ownership`. |
| `OwnershipTransferCancelled` | `owner: Address` | — | The owner withdrew a pending offer. |
| `OwnershipTransferred` | `previous_owner: Option<Address>`, `new_owner: Address` | — | The pending owner accepted, or the constructor set the first owner (`previous_owner` is `None`). |
| `OwnershipRenounced` | `previous_owner: Address` | — | The owner renounced; the contract has no owner from here on. |

```text
OwnershipTransferStarted
  topic  {"symbol":"ownership_transfer_started"}
  topic  {"address":"GD44HSZYUSV3FMG5GHCXUMDNGDRSCHPYMKBEKTOUGOABNELL3XPX4L2O"}
  topic  {"address":"GCUWQNBGVHEJ622VFMFWDODLVLVAZCTKRTS5E4JCWU6U54YM5ABU7AOO"}
  data   live_until_ledger  {"u32":1000}
OwnershipTransferCancelled
  topic  {"symbol":"ownership_transfer_cancelled"}
  topic  {"address":"GD44HSZYUSV3FMG5GHCXUMDNGDRSCHPYMKBEKTOUGOABNELL3XPX4L2O"}
  data   {"map":[]}
OwnershipTransferred
  topic  {"symbol":"ownership_transferred"}
  topic  {"address":"GD44HSZYUSV3FMG5GHCXUMDNGDRSCHPYMKBEKTOUGOABNELL3XPX4L2O"}
  topic  {"address":"GCUWQNBGVHEJ622VFMFWDODLVLVAZCTKRTS5E4JCWU6U54YM5ABU7AOO"}
  data   {"map":[]}
OwnershipRenounced
  topic  {"symbol":"ownership_renounced"}
  topic  {"address":"GD44HSZYUSV3FMG5GHCXUMDNGDRSCHPYMKBEKTOUGOABNELL3XPX4L2O"}
  data   {"map":[]}
```

#### Every contract that stores a `TtlConfig`

| Event | Topics after the name | Data | Meaning |
|---|---|---|---|
| `TtlConfigUpdated` | — | `ledger_close_ms: u32`, `min_persistent_ttl: u32` | The `TtlConfig` in force, from `__constructor` and every `set_ttl_config`. |

```text
TtlConfigUpdated
  topic  {"symbol":"ttl_config_updated"}
  data   ledger_close_ms     {"u32":5000}
         min_persistent_ttl  {"u32":120960}
```
<!-- /generated:events -->

## Storage keys

Each variant's first column is the key. The second says where the key lives
and its TTL class. The third names the value and the EVM storage it replaces.

<!-- generated:keys -->
#### `square_job`: `SquareJobKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `PaymentToken` | instance | the USDC SAC, fixed at construction (`_paymentToken`). |
| `JobCounter` | instance | `u64`, the last job id issued (`_jobCounter`). |
| `PlatformFeeBp` | instance | `u32`, the platform fee in force (`_platformFeeBP`). |
| `EvaluatorFeeBp` | instance | `u32`, the evaluator fee in force (`_evaluatorFeeBP`). |
| `Treasury` | instance | `Address`, where platform fees are credited (`_platformTreasury`). |
| `PendingFees` | instance | the fee change waiting for its notice to pass (`_pendingPlatformFeeBP`, `_pendingEvaluatorFeeBP`, `_feesEffectiveFrom`). |
| `TotalWithdrawable` | instance | `i128`, the sum of every `Withdrawable` (`_totalWithdrawable`). |
| `TotalEscrowed` | instance | `i128`, the budgets of Funded and Submitted jobs (`_totalEscrowed`). |
| `Job(u64)` | persistent, J | `JobRecord` (`_jobs`). |
| `ComplianceProof(u64)` | persistent, J | `Bytes`, at most 1 024 (`_complianceProofs`). |
| `Withdrawable(Address)` | persistent, J of the crediting job | `i128` (`_withdrawable`); removed at zero. |
| `HookWhitelisted(Option<Address>)` | persistent, G | `bool` (`_whitelistedHooks`); `None` is "no hook". |

#### `keeper_evaluator`: `KeeperEvaluatorKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `SquareJob` | instance | the kernel, fixed at construction (`_squareJob`). |
| `Arbitration` | instance | the arbitration contract, set once (`_arbitration`). |
| `WindowCount` | instance | `u32`, how many windows have been pushed. |
| `Window(u32)` | persistent, G | `Window`, append-only (`_windows`). |
| `Dispute(u64)` | persistent, D | `DisputeRef` (`_disputes`). |

#### `arbitration`: `ArbitrationKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `Token` | instance | the USDC SAC bonds are paid in (`_token`). |
| `KeeperEvaluator` | instance | the keeper evaluator that opens disputes (`_keeperEvaluator`). |
| `SquareJob` | instance | the kernel (`_squareJob`). |
| `CurrentVersion` | instance | `u32`, the arbiter set version new disputes open under (`_currentVersion`). |
| `BondBps` | instance | `u32` (`_bondBps`). |
| `MinBond` | instance | `u64` (`_minBond`). |
| `Arbiters(u32)` | persistent, G | `Vec<Address>`, the arbiters of a version (`_arbiters`). |
| `Threshold(u32)` | persistent, G | `u32` (`_threshold`). |
| `ArbiterIndex(u32, Address)` | persistent, G | `u32`, an arbiter's index plus one in a version (`_indexPlusOne`). |
| `Dispute(u64)` | persistent, D | `Dispute` (`_disputes`). |
| `Approval(u64, BytesN<32>)` | persistent, D | `U256`, the vote bitmask of one resolution (`_approvals`). |
| `Withdrawable(Address)` | persistent, D of the crediting dispute | `i128` (`_withdrawable`); removed at zero. |

#### `claim_market`: `ClaimMarketKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `SquareJob` | instance | the kernel (`_squareJob`). |
| `KeeperEvaluator` | instance | the keeper evaluator (`_keeperEvaluator`). |
| `Token` | instance | the USDC SAC the price is paid in (`_token`). |
| `PolicyRegistry` | instance | where each poster's buyer root is read (`_policyRegistry`). |
| `Listing(u64)` | persistent, J | `Listing` (`_listings`). |

#### `square_hook`: `SquareHookKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `Kernel` | instance | the kernel whose calls the hook serves (`_squareJob`). |
| `PaymentToken` | instance | the USDC SAC (`_paymentToken`). |
| `ClaimMarket` | instance | the claim market (`_claimMarket`). |
| `IdentityRegistry` | instance | the 8004 identity registry (`_identityRegistry`). |
| `ReputationRegistry` | instance | the 8004 reputation registry (`_reputationRegistry`). |
| `ValidationRegistry` | instance | the 8004 validation registry (`_validationRegistry`). |
| `ComplianceModule` | instance | `Address`, absent while no module is installed (`_complianceModule`). |
| `Screening` | instance | `Address`, absent while no screening is installed (`_screening`). |
| `TrustedEvaluator` | instance | `Address`, whose jobs earn positive reputation (`_trustedEvaluator`). |
| `MinReputationBudget` | instance | `u64` (`_minReputationBudget`). |
| `ReputationWrites` | instance | `bool`, the reputation write switch (new on Soroban). |
| `ValidationWrites` | instance | `bool`, the validation write switch (new on Soroban). |
| `BoundAgent(u64)` | persistent, J | `u32`, the agent bound at submit (`_boundAgentPlusOne`). |
| `ValidationOf(u64)` | persistent, J | `BytesN<32>`, the validation request bound at submit (`_validationOf`). |
| `Recorded(u64)` | persistent, J | `bool`, reputation written once (`_recorded`). |

#### `compliance_module`: `ComplianceModuleKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `Hook` | instance | the hook whose `check_release` calls are booked (`_hook`). |
| `Verifier` | instance | the Groth16 verifier, fixed at construction (`_verifier`). |
| `PolicyRegistry` | instance | the policy registry, fixed at construction (`_registry`). |
| `Kernel` | instance | the kernel, fixed at construction (`_squareJob`). |
| `TimestampTolerance` | instance | `u64`, seconds (`_timestampTolerance`). |
| `Consumed(BytesN<32>)` | persistent, U | `bool`, a spent statement (`_consumed`), until the proof's timestamp plus the tolerance. |

#### `policy_registry`: `PolicyRegistryKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `Policy(Address)` | persistent, G on write and J on use | `Policy` (`_policies`). |
| `DailySpend(Address)` | persistent, U until the next policy day | `DailySpend` (`_spend`). |
| `BuyerRoot(Address)` | persistent, G on write and J on use | `BytesN<32>` (`_buyerRoots`). |
| `Spender(Address)` | persistent, G | `bool` (`_spenders`). |

#### `screening_registry`: `ScreeningRegistryKey`

| Key | Storage and TTL class | Value, and its EVM origin |
|---|---|---|
| `MaxAge` | instance | `u64`, seconds a record clears its subject (`_maxAge`). |
| `Record(Address)` | persistent, U until `screened_at + max_age` | `ScreeningRecord` (`_records`). |
| `Screener(Address)` | persistent, G | `bool` (`_screeners`). |

<!-- /generated:keys -->

## When the 8004 registries are written

The hook writes to the three registries
([8004-registries-on-stellar.md](../decisions/8004-registries-on-stellar.md)),
always as itself.

| Moment | Registry call | Who is credited |
|---|---|---|
| `submit`, with `SubmitParams { agent_id, request_hash }` | None is written. The hook checks that the identity registry's `find_owner(agent_id)` or `get_agent_wallet(agent_id)` is the provider, and binds the job to the agent (`AgentBound`). | — |
| `complete`, in `after_action` | `give_feedback(hook, agent_id, 1, 0, "square", "completed", "", "", reason)` | The job's provider agent, never the payee. A sold receivable moves the money, not the credit. |
| `complete`, in `after_action`, for a job whose provider opened a validation request | `validation_response(hook, request_hash, paid ? 100 : 0, "", evidence, "square.settlement")`, where `evidence` is `hash::evidence_hash` of the settlement (`EvidenceRecorded`) | The agent that opened the request. |
| `reject` from Submitted, in `after_action` | `give_feedback(…, -1, …, "rejected", …)` and `validation_response(…, 0, …)` | The provider agent. |
| `reject` from Open or Funded | Nothing. No work was delivered, so no signal is warranted. | — |
| `claim_refund` (Expired) | Not hookable, so nothing at the moment of expiry. `record_expiry(job_id)` is permissionless, checks that the job is Expired, and writes `give_feedback(…, 0, …, "expired", …)` once. The keeper calls it. | The provider agent. |

**Registry writes are advisory.**

- Each write is tried: a registry that fails emits `ReputationWriteFailed`
  or `ValidationWriteFailed`, and settlement proceeds.
- A registry that exhausts the budget cannot be caught on Soroban. So the
  owner's `set_registry_writes(reputation, validation)` switches take each
  write out of the settlement path (`RegistryWritesUpdated`;
  [call-graph-on-soroban.md](../decisions/call-graph-on-soroban.md#5-tolerant-hook-calls-what-a-hook-informs-it-never-vetoes-means-on-soroban)).

## Rebuilding state from events only

The indexer's reducer, per job, in event order. Each row is the only input
it needs; nothing is read from the chain.

| Event | Reducer |
|---|---|
| `JobCreated` + `JobDescribed` | Insert the row: Open, client, provider (may be unset), evaluator, `expired_at`, hook, description, `created_at`. |
| `ProviderSet` | Set the provider. |
| `BudgetSet` | Set the budget. |
| `JobFunded` + `FeesSnapshotted` | Funded, the budget (authoritative), the fee snapshot and `funded_at`. `net = budget − fees`. |
| `JobSubmitted` + `SubmissionTimed` | Submitted, the deliverable and `submitted_at`. `challenge_end = submitted_at +` the window in force, from the `WindowsConfigured` history. |
| `DisputeRaised` / `DisputeOpened` | Disputed: finalize is blocked. Record `resolve_by`. |
| `VoteCast` | The approvals per resolution. |
| `DecisionReached` / `DisputeExpired` | The decided outcome. |
| `PayoutRouted` + `PaymentReleased` + `Refunded` + `EvaluatorFeePaid` + `PlatformFeeAccrued` + `JobCompleted` | Completed: the payee, `provider_bps` and the ledger credits. |
| `JobRejected` + `Refunded` | Rejected: a ledger credit to the client. |
| `JobExpired` + `Refunded` | Expired: a ledger credit to the client. |
| `Withdrawn` | A ledger debit. |
| `ClaimListed` / `ClaimBought` / `ClaimCancelled` | The listing state, and the payee for the query surface. |
| `BondSettled` / `BondWithdrawn` | The bond ledger. |

**The three query surfaces fall out of the row:**

- open jobs are `status ∈ {Open, Funded}`;
- an agent's jobs are `provider = ?`;
- escrows in the challenge window are
  `status = Submitted AND NOT disputed AND now < challenge_end`.

**Sufficiency is proved by a test, not an argument.** The indexer's
differential test drives every path on a local network and rebuilds the
state from events. It then compares the result, field by field, with
`get_job_record`, `withdrawable`, the disputes and the listings read from the
chain. A mismatch is a bug in this schema.

## What was considered and rejected

- **Widening `JobCreated` to carry the description.**
  - It would save one event per job.
  - But it would move the event away from the ERC-8183 shape that indexers
    of the standard look for. A second event, `JobDescribed`, costs less.
- **Positional `data` (a vector) instead of a map.**
  - A vector is a few bytes smaller.
  - But a reader then depends on field order, and a field added later
    shifts every field after it. The map names each field and survives
    additions.
- **Each contract defining its own events.**
  - It would keep a contract's spec small without spec shaking.
  - But the schema would then live in nine crates while this page is
    written from one. Spec shaking gives each Wasm its own events anyway.
- **A `Disputed` status.** ERC-8183 has six statuses and no room for a
  seventh. A dispute is the evaluator declining to act, which the standard
  already allows. The fact of the dispute is an event on the evaluator, where
  it belongs.
- **Storing `reason` on the job.**
  - Every reader that wants the reason has the event, and the hook forwards
    it to the reputation registry as the feedback hash.
  - A ledger entry that no contract reads back is rent spent for nothing.
- **An `i128` budget with a separate `< 2^64` check.** It would work, but it
  puts the circuit's ceiling in two places. A `u64` puts it in one.
