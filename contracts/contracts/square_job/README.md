# `square_job` — the kernel, MVP

The escrow between a client and a provider (an AI agent, in the MVP), paid in
one SEP-41 token, settled by a **challenge window**: after the provider
submits, the client may reject for `challenge_window` seconds and be refunded;
once the window has passed, anyone may finalize and the provider is credited
the budget less the platform fee. No evaluator, hook, compliance proof or
arbitration in this form; those are the phase-2 issues
([#9](https://github.com/Square-StellarNetwork/square-stellar/issues/9) keeps
the full list).

Decisions applied: [auth-and-token-flow.md](../../../docs/decisions/auth-and-token-flow.md)
(explicit signers, no approve, `i128` at the boundary and `u64` in the record),
[fees-and-ttl.md](../../../docs/decisions/fees-and-ttl.md) decision 4 (TTL
classes J and G through `square_common::ttl`),
[upgradeability-and-governance.md](../../../docs/decisions/upgradeability-and-governance.md)
(no upgrade entry point; the two-step owner of `square_common::owner`).

## The state machine

```text
create_job ──set_budget──▶ Open ──fund──▶ Funded ──submit──▶ Submitted
                            │               │                    │
                         reject          reject             reject, inside the window
                            ▼               ▼ claim_refund       ▼             finalize, after it (anyone)
                         Rejected      Rejected / Expired     Rejected         Completed
```

- `expired_at` bounds `fund` and `submit`. A Funded job that passes it without
  a submission is refunded by `claim_refund`. A submission stops that clock:
  a Submitted job resolves only by `reject` or `finalize`
  ([expiry-after-submission.md](../../../docs/decisions/expiry-after-submission.md)).
- The window may be zero at deployment: then `finalize` opens the moment the
  provider submits and no submission can be rejected.

## Functions and who signs

| Function | Authorizes | Token movement |
|---|---|---|
| `create_job(client, provider, expired_at, description) → job_id` | `client` | — |
| `set_budget(caller, job_id, amount)` | `caller`, the job's client or provider; Open only | — |
| `fund(client, job_id, expected_budget)` | `client`, the job's client; Open, before `expired_at`, `expected_budget` = the budget | `client → kernel`, one authorization entry for the call and the `transfer` beneath it |
| `submit(provider, job_id, deliverable)` | `provider`, the job's provider; Funded, before `expired_at` | — |
| `finalize(job_id)` | nobody: anyone after `submitted_at + challenge_window` | credits only |
| `reject(client, job_id, reason)` | `client`, the job's client; Open, Funded, or Submitted inside the window | credits only |
| `claim_refund(job_id)` | nobody: anyone once a Funded job passes `expired_at` | credits only |
| `withdraw_to(account, to, amount)` | `account`, the holder of the balance | `kernel → to` |
| `skim(to)` | owner | `kernel → to`, only what is above the totals |
| `set_ttl_config(ledger_close_ms, min_persistent_ttl)` | owner | — |
| `transfer_ownership(new_owner, live_until_ledger)`, `accept_ownership()` | owner; then the offered address | — |

Views: `get_job`, `withdrawable(account)`, `job_counter`, `config`,
`ttl_config`, `owner`, `total_escrowed`, `total_withdrawable`, `unaccounted`.

The constructor: `__constructor(owner, token, challenge_window, platform_fee_bps,
ledger_close_ms, min_persistent_ttl)`. `platform_fee_bps` is at most 2,000; the
last two are the network's `ledgerTargetCloseTimeMilliseconds` and
`minPersistentTtl` (5,000 and 120,960 on testnet), read by the deploy script.
Settings do not change after deployment; a job records the fee and the window
it was created under.

## Money

The kernel holds exactly `total_escrowed + total_withdrawable`: budgets of
Funded and Submitted jobs, plus every credit not yet withdrawn. `finalize`
credits `budget − fee` to the provider and `fee = budget × bps / 10_000`
(rounded down) to the owner; `reject` and `claim_refund` credit the whole
budget back to the client. Every credit is pulled with `withdraw_to`. The test
`solvency_holds_under_random_action_sequences` checks the equality after each
of 400 random actions.

## Error codes

| Code | Name | When |
|---:|---|---|
| 1 | `InvalidJob` | no job has this id |
| 2 | `WrongStatus` | the action does not apply to the job's status |
| 3 | `NotClient` | the signer is not the job's client |
| 4 | `NotProvider` | the signer is not the job's provider |
| 5 | `NotParty` | `set_budget` by neither party |
| 6 | `SameParty` | client and provider are one address |
| 7 | `ExpiryTooShort` | `expired_at` not after the ledger's time |
| 8 | `TextTooLong` | description or reason over 256 bytes |
| 9 | `InvalidAmount` | not positive, or over `u64` |
| 10 | `ZeroBudget` | `fund` before `set_budget` |
| 11 | `BudgetMismatch` | `fund`'s `expected_budget` is not the budget |
| 12 | `Expired` | `fund` or `submit` at or after `expired_at` |
| 13 | `NotExpired` | `claim_refund` before `expired_at` |
| 14 | `WindowOpen` | `finalize` inside the window |
| 15 | `WindowClosed` | `reject` of a submission after the window |
| 16 | `InsufficientBalance` | `withdraw_to` over the balance |
| 17 | `NothingToSkim` | the balance is fully accounted for |
| 18 | `FeeTooHigh` | constructor fee over 2,000 bps |
| 19 | `InvalidTtlConfig` | a zero `TtlConfig` field |
| 100 | `NoPendingOffer` | `accept_ownership` with no offer |
| 101 | `OfferExpired` | the offer's ledger has passed |
| 102 | `SameOwner` | ownership offered to the owner |

The token contract's own errors come back as its own, decoded by contract id,
`#13` for a missing trustline among them (`packages/core/src/stellar/errors.ts`).

## Events

`topics[0]` is the name, the `#[topic]` fields follow, and the data is a map of
the rest. The definitions are in the contract spec, so the bindings and the
SDK's decoder read them from the Wasm.

| Name | Topics | Data |
|---|---|---|
| `job_created` | `job_id`, `client`, `provider` | `expired_at`, `challenge_window`, `platform_fee_bps`, `description` |
| `budget_set` | `job_id` | `by`, `amount` |
| `funded` | `job_id`, `client` | `amount` |
| `submitted` | `job_id`, `provider` | `deliverable`, `submitted_at`, `finalize_after` |
| `finalized` | `job_id`, `provider` | `payout`, `fee` |
| `rejected` | `job_id`, `client` | `refund`, `reason` |
| `refunded` | `job_id`, `client` | `amount` |
| `withdrawn` | `account`, `to` | `amount` |
| `skimmed` | `to` | `amount` |
| `ownership_offered` | `from`, `to` | `live_until_ledger` |
| `ownership_transferred` | `from`, `to` | — |

## Storage and TTL

| Key | Kind | TTL rule |
|---|---|---|
| `Job(job_id)` | persistent | class J: lives until `expired_at + challenge_window`, plus one window of slack, on every write |
| `Withdrawable(account)` | persistent | class G: refreshed to `min_persistent_ttl` on every credit and debit |
| `Config`, `Ttl`, `JobCounter`, `TotalEscrowed`, `TotalWithdrawable`, `Owner`, `PendingOwner` | instance | class G: the instance is refreshed on every write |

## Tests

`cargo test -p square_job`: the optimistic path with every event checked, the
reject paths (Open, Funded, inside and after the window), expiry and
`claim_refund`, the guards of each function, unsigned calls (refused) against
the two cranks (not), the owner functions under a non-owner's authorization,
two-step ownership, TTL of the record and of balances, the fee arithmetic and
the solvency invariant. The token is a Stellar Asset Contract registered in
the test host, the same contract the native XLM SAC is on the network.
