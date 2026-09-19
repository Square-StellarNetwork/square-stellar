# The call graph on Soroban: the kernel pushes, nothing calls back

**Status:** decided in [#3][i3]. The types below are the input to the storage
and event schema in [#8][i8]. The decisions bind the kernel in [#9][i9], the
compliance module in [#12][i12], the hook in [#13][i13], the keeper evaluator
in [#14][i14], arbitration in [#15][i15] and the claim market in [#16][i16].
The test plan is for [#18][i18]. The measurements below are from 2026-09-19.

[i3]: https://github.com/Square-StellarNetwork/square-stellar/issues/3
[i5]: https://github.com/Square-StellarNetwork/square-stellar/issues/5
[i6]: https://github.com/Square-StellarNetwork/square-stellar/issues/6
[i8]: https://github.com/Square-StellarNetwork/square-stellar/issues/8
[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9
[i12]: https://github.com/Square-StellarNetwork/square-stellar/issues/12
[i13]: https://github.com/Square-StellarNetwork/square-stellar/issues/13
[i14]: https://github.com/Square-StellarNetwork/square-stellar/issues/14
[i15]: https://github.com/Square-StellarNetwork/square-stellar/issues/15
[i16]: https://github.com/Square-StellarNetwork/square-stellar/issues/16
[i18]: https://github.com/Square-StellarNetwork/square-stellar/issues/18
[i49]: https://github.com/Square-StellarNetwork/square-stellar/issues/49
[e100]: https://github.com/Square-StellarNetwork/square/issues/100
[e225]: https://github.com/Square-StellarNetwork/square/issues/225
[e245]: https://github.com/Square-StellarNetwork/square/issues/245
[e307]: https://github.com/Square-StellarNetwork/square/issues/307

Links named `square#N` point to the EVM repository the port starts from. Plain
`#N` links point to this repository. Solidity paths are relative to
`contracts/src/` unless they start with `contracts/test/`.

## The problem

The EVM design lets a hook ask the kernel for what it needs, in the middle of
the kernel's own call. `SquareJob.complete` calls `SquareHook.resolvePayout`.
That calls `ClaimMarket.payeeOf`, which calls `SquareJob.providerOf` while
`SquareJob` is still running. Fourteen such edges are listed
[below](#the-reentrant-edges-of-the-evm-design-and-where-each-one-goes). Four
facts about Soroban rule the pattern out.

**1. The host refuses to re-enter any contract already on the call stack,
including a contract calling itself.** Both host call paths, `call` and
`try_call`, use `CallParams::default_external_call()`, and that sets
`ContractReentryMode::Prohibited`. Before it dispatches a call, the host
searches the context stack for the callee. If it finds it, the call fails
with `Error(Context, InvalidAction)` ("Contract re-entry is not allowed").
Sources, at the tag the lockfile resolves (`soroban-env-host 27.0.1`, pulled
in by `soroban-sdk =27.0.6`):

- [`frame.rs` L24-35, L106-122, L924-955](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-host/src/host/frame.rs#L924-L955)
- [`host.rs` L2579-2612 (`call`) and L2615-2679 (`try_call`)](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-host/src/host.rs#L2579-L2679)

**2. There is no per-call gas limit. The budget belongs to the transaction,
and running out of it cannot be caught.** Stellar's documentation lists the
metered resources: CPU instructions, ledger entry accesses, ledger I/O bytes,
transaction size, and events plus return value. Memory is capped too. It says
"All resources mentioned in the prior section are subject to a
per-transaction limit" and "If the transaction attempts to exceed the declared
resource limits, it will fail"
([Resource limits and fees](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)).

`try_call` turns only *recoverable* errors into a value. Two kinds of error
are not recoverable:

- `Error(Budget, ExceededLimit)`;
- `Error(Storage, ExceededLimit)`, which means touching an entry outside the
  footprint.

Both escalate past every `try` on the stack
([`error.rs` L145-166, `is_recoverable`](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-host/src/host/error.rs#L145-L166);
`try_call` L2650-2677). A recoverable error that is not a contract error
reaches the caller narrowed to `Error(Context, InvalidAction)`. The detail
stays in the diagnostic events only.

**3. There is no read-only call.** The host's `call` module exports exactly
two functions, `call` and `try_call`
([`env.json`](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-common/env.json)).
The SDK wraps them as `Env::invoke_contract` and `Env::try_invoke_contract`
([docs.rs](https://docs.rs/soroban-sdk/27.0.6/soroban_sdk/struct.Env.html)).
Nothing like `STATICCALL` stops a callee from writing. The EVM
`resolvePayout` is a `view` that the kernel `staticcall`s. On Soroban,
"the resolver writes nothing" is a property of the hook's code, not something
the host enforces.

**4. There is no ERC-165.** No standard lets a contract say which interfaces
it implements.

What *is* guaranteed:

- **A failed frame writes nothing.** When a callee fails, the host restores
  the storage map and marks the events of that frame as failed
  ([`frame.rs` `pop_context`, L211-227](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-host/src/host/frame.rs#L211-L227)).
- **A contract's direct calls carry its authority.** "All the direct calls
  that the current contract performs are always considered to have been
  authorized" (`Env::authorize_as_current_contract`, same docs.rs page). So
  a callee's `caller.require_auth()` passes when `caller` is the contract
  that invoked it directly. That is how every `onlyX` modifier below is
  ported.

### Measured

The probe `contracts/probes/call_graph_probe` stands in for the kernel. It is
a contract whose `complete(hook)` calls `hook.after_action(kernel)` through
`try_invoke_contract` and emits `hookfail` on any failure. Its nine tests pass:

```console
$ cd contracts && cargo test -p call_graph_probe -- --nocapture
call_self: Err(Ok(Error(Context, InvalidAction)))
events: [ContractEvent { ... topics: VecM([Symbol(ScSymbol(StringM(hookfail)))]) ... }]
complete with a budget-eating hook: HostError: Error(Budget, ExceededLimit)
horizon_of(G… account): Err(Ok(Error(Context, InvalidAction)))
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

| Test (`src/test.rs`) | Hook does | Result |
|---|---|---|
| `a_hook_that_behaves_returns_its_value` | returns `1` | `Returned(1)` |
| `a_callback_into_the_kernel_is_refused_by_the_host` | calls `kernel.status()` while the kernel is on the stack | the host refuses the call, and the kernel's `try` turns it into `Failed` plus the `hookfail` event. Called directly, not through the kernel, the same read returns `7`. |
| `a_contract_calling_itself_is_refused` | the kernel's `call_self` calls its own `status` (the `try this.f()` pattern) | `Error(Context, InvalidAction)` |
| `a_panicking_hook_is_caught_and_the_kernel_carries_on` | `panic!` | `Failed`; the kernel returns normally |
| `a_hook_returning_the_wrong_type_is_caught` | returns a `String` where the interface says `u32` | `Failed`. By the SDK source (`env.rs` L441-462), `try_invoke_contract` yields `Ok(Err(ConversionError))` here. |
| `a_hook_that_exhausts_the_budget_fails_the_whole_call` | loops on `sha256` over a growing buffer | the kernel's `try` does not catch it. The host logs "escalating error to panic" and the test caller's own `try_complete` gets no `Err` back: the whole invocation is gone with `Error(Budget, ExceededLimit)`. |

Three more tests matter for decision 6. The probe's `horizon_of(evaluator)`
does what an ERC-165-style probe would: `try_invoke_contract(evaluator,
"settlement_horizon")`, falling back to 0.

**They measure calls to an address that is not a Wasm contract**
(`probing_a_contract_without_the_function_is_caught`,
`probing_an_account_address_fails_the_caller`):

- **A contract without the function, or a contract address with nothing
  deployed:** `try_invoke_contract` returns an `Err`, which the caller
  catches.
- **An account address (`G…`):** the caller cannot catch the failure. The
  whole invocation of the calling contract fails with
  `Error(Context, InvalidAction)`.

**Why the account case cannot be caught.** In `try_call` the callee address
is converted to a contract id with `?` *before* the recoverable-error match
(`host.rs` L2636-2641,
[`data_helper.rs` L500 `contract_id_from_address`](https://github.com/stellar/rs-soroban-env/blob/v27.0.1/soroban-env-host/src/host/data_helper.rs#L500)).
An account address fails that conversion, so the error bypasses the `try`.

**How to tell the cases apart without calling.** `Address::executable()` does
it: `Some(Executable::Wasm(_))` for a contract, `Some(Executable::Account)`
for an existing account, `None` for an address with nothing behind it
(`soroban-sdk-27.0.6/src/address.rs` L324-336). The test
`executable_tells_contract_account_and_asset_apart` gives `None` for a `G…`
address with no account entry, `Wasm` for a registered contract,
`StellarAsset` for a SAC and `None` for a contract address with nothing
deployed.

## The decision

**On Soroban, no contract calls back into a contract that is already on the
stack.** The kernel sends the hook everything the hook needs. The hook sends
the module everything the module needs. The call graph below shows the
result: every edge goes to a contract that is not yet on the stack.

The seven decisions follow. Each one gives the Soroban rule, the EVM
construct it replaces, and what happens to the EVM tests that cover it.

### 1. Push model: `HookContext`

The kernel passes the hook a `HookContext`. It holds everything about the job
that the EVM hook read from the kernel, and the hook reads nothing from the
kernel while the kernel is running. The interface (types in
[Types](#types-input-to-8)):

```rust
fn supports(env: Env, interface: Symbol) -> bool;
fn before_action(env: Env, ctx: HookContext, action: Action) -> BeforeOutcome;
fn after_action(env: Env, ctx: HookContext, action: Action, before: BeforeOutcome);
fn resolve_payout(env: Env, ctx: HookContext, params: CompleteParams) -> (Address, u32);
```

**The kernel builds the context twice:**

- For `resolve_payout` and `before_action`, it builds the context before the
  state transition.
- For `after_action`, it builds it again after the transition, so the hook
  sees what the EVM `afterAction` saw when it called `getJobRecord`: the
  final status, the payee and the split.

On `complete`, the context passed to `before_action` and `after_action`
carries `payout`: the payee, split and shares the kernel is about to credit,
or has credited.

**What replaces the transient storage.** The EVM hook used `transient`
fields (`_checkedJob`, `_checkOutcome`, `_screenOutcome`, `_screenCommitment`,
`SquareHook.sol:51-54`) to carry results from `beforeAction` to
`afterAction`. Those fields are gone. `before_action` returns a
`BeforeOutcome`, and the kernel hands it to `after_action`. If the tolerant
`before_action` failed, the kernel hands over `BeforeOutcome` with every
field `NotRun`/`None`.

**Why the EVM job key goes too.** On EVM the outcome was keyed by the job so
that a check for one job could not be read as another's
(`test_afterAction_ignoresACheckThatRanForAnotherJob`). Here the value
travels in the arguments of the one call it belongs to, so that confusion
cannot happen.

**`action` is typed.** It is an `Action` enum whose variants carry each
action's arguments and parameters, not a `Symbol` plus opaque data. So the
action and its data cannot disagree, and a hook built for a different set of
actions fails to decode instead of misreading.

**Only the kernel may call the callbacks.** The hook is constructed with its
kernel's address. `before_action` and `after_action` call
`kernel.require_auth()`, which passes only when the kernel is the direct
invoker. That is the port of `onlyKernel`.

**`resolve_payout` needs no auth.** It writes nothing, and its answer only
matters to the kernel that supplied the context. The same holds for
`proof_state`.

**Why the context can be trusted:**

- The context is trustworthy only because the kernel sent it. The hook
  trusts it after `kernel.require_auth()`.
- The module trusts the `Release` the hook builds from it only after
  `hook.require_auth()` (decision 3).

| | EVM | Soroban |
|---|---|---|
| Hook reads the job | `_squareJob.getJobRecord`, `complianceProofOf`, `netPayout`, `paymentToken`, `payoutOf` from inside the kernel's call (`SquareHook.sol:171, 234-236, 246, 259, 298-304, 358, 379-381, 486, 505`) | the fields of `HookContext` |
| Before → after | `transient` fields keyed by `_checkedJob` (`SquareHook.sol:51-54, 314-320, 328-335`) | `BeforeOutcome` returned, carried by the kernel |
| Who may call | `onlyKernel` | `kernel.require_auth()` |
| Policy pin | `SquareHook._commitmentAtFund[jobId]`, written in `beforeAction(FUND)` (`SquareHook.sol:270-277`) and read back by the module through `commitmentAtFund` (`ComplianceModule.sol:380-381`) | `before_action(Fund)` returns it as `BeforeOutcome.policy_pin`. The kernel stores it on the job and sends it back as `HookContext.commitment_at_fund`. |

**Tests:**

- `contracts/test/SquareHook.t.sol` `test_onlyTheKernelMayCallTheCallbacks`
  becomes an auth test: a caller other than the kernel fails
  `kernel.require_auth()`.
- `test_afterAction_ignoresACheckThatRanForAnotherJob` loses its
  `KernelBatcher` (`contracts/test/mocks/KernelBatcher.sol`), because no
  state is shared between calls. It becomes two assertions in [#18][i18]:
  - `after_action` receives exactly the `BeforeOutcome` that `before_action`
    returned in the same `complete`;
  - a failed `before_action` arrives as all-`NotRun`.
- `test_afterAction_writesNoVerdictWhenTheCheckNeverRan` keeps its assertion
  on that all-`NotRun` input.

### 2. `claim_market` does not read the kernel during `complete`

The new signature is `payee_of(job_id, provider) -> Address`. It returns the
buyer when the listing is `Sold`, and otherwise the `provider` it was given.
It reads only the market's own listing.

The EVM `payeeOf(jobId)` read `SquareJob.providerOf(jobId)`
(`ClaimMarket.sol:81-85`). It was called from `resolvePayout`
(`SquareHook.sol:165`) and from `_checkRelease` (`SquareHook.sol:299`), both
while the kernel was on the stack. That was a reentrant view.

`list` and `buy` keep their reads of the kernel (`get_job_record`,
`net_payout`), of `keeper_evaluator.is_disputed` and of
`hook.payout_market`. On those paths the market is the first contract on the
stack, so none of the callees is on it ([call graph](#list-and-buy)).

**Tests:** `contracts/test/SquareHook.t.sol`
`test_complete_aSoldClaimIsProtectedTheSameWay` and the `ClaimMarket.t.sol`
routing tests keep their assertions. `payee_of` is now called with the
provider the context names.

### 3. `compliance_module` takes the hook and the pin from the release

`preview_release(release, proof)` and `check_release(release, proof)` take a
`Release` that carries `hook` and `commitment_at_fund` next to `payee`,
`amount`, `token` and `client`.

**`check_release` runs only on the registered hook's authority.** The module
reads its registered hook from its own storage and calls
`registered_hook.require_auth()`. The call passes only when the registered
hook is the direct invoker. It also refuses a `release.hook` that is not the
registered hook.

**`preview_release` compares `release.hook` with the registered hook.** It
refuses with the reason the EVM `R_HOOK` carried
(`ComplianceModule.sol:323`). It still refuses what `check_release` could not
book: the module not being a registered spender of `policy_registry`
([square#225][e225]).

**The pin comes from the release.** When `release.commitment_at_fund` is
`None` (a job funded before a module was installed), the module falls back
to the live `policy_registry.commitment_of(client)`, as `_commitmentFor`
does on EVM.

| | EVM | Soroban |
|---|---|---|
| Is the booking hook the job's hook? | `_hookBooks` → `_squareJob.getJobRecord(jobId).hook` (`ComplianceModule.sol:439-448`), a read of the kernel during `complete` | `release.hook == registered hook`. The hook fills `release.hook` from `ctx.hook`. |
| Only the hook books | `onlyHook` (`ComplianceModule.sol:185, 254-261`) | `registered_hook.require_auth()` |
| Pinned commitment | `IPolicyCommitmentPin(_hook).commitmentAtFund(jobId)` (`ComplianceModule.sol:380-381`), a call back into the hook while the hook is on the stack | `release.commitment_at_fund` |

**Tests:** these `contracts/test/ComplianceModule.t.sol` tests keep their
assertions, now against the `Release` argument:

- the `R_HOOK` preview tests;
- the pinned-commitment tests of [proof-required.md](proof-required.md)
  (decision 2 there).

One test is new: `check_release` called by any address other than the
registered hook fails auth.

### 4. No contract calls itself

The EVM code uses an external self-call where it needs to catch a revert:

- `try this.previewVerdict` (`SquareHook.sol:194`);
- `try this.settlementFacts` (`SquareHook.sol:513`);
- `try this.verifiedSignals` (`ComplianceModule.sol:334, 373`).

The host refuses all three (measured: `a_contract_calling_itself_is_refused`).

In Rust, the decoding and checking these self-calls wrapped are internal
functions that return `Result`. Only calls that leave the contract are
wrapped in `try_invoke_contract`:

- `policy_registry`;
- `screening_registry`;
- `groth16_verifier` (a malformed point traps the verifier, as
  [groth16-on-soroban.md](groth16-on-soroban.md) records);
- the 8004 registries.

`settlementFacts` disappears. The facts it read (`SquareJob.payoutOf`) are
`ctx.payout`.

**Tests:** none of the EVM tests targets the self-call itself. They test
what it catches: a malformed proof reads as `R_MALFORMED`/`R_INVALID` and
does not revert `complete`. Those tests keep their assertions.

### 5. Tolerant hook calls: what "a hook informs, it never vetoes" means on Soroban

The principle of [hook-failure-modes.md](hook-failure-modes.md)
([square#100][e100]) stays. The mechanism changes:

- **Tolerant calls.** On `complete` and `reject`, the kernel calls
  `before_action` and `after_action` through `try_invoke_contract`. It
  treats `Err(_)` and `Ok(Err(_))` alike: it emits `HookFailed`, with the
  error value when there is one, and finishes the transition.
- **Strict calls.** `set_provider`, `set_budget`, `fund` and `submit` use
  `invoke_contract`, so a hook failure fails the action and the caller can
  retry.
- **`resolve_payout` stays strict in `complete`.** It is tried in
  `claim_refund`, as `_payoutResolvable` is on EVM (`SquareJob.sol:439-449`).

**What `HookFailed` carries.** A hook that fails with a contract error
(`panic_with_error!`) arrives with its own code. Every host-side failure
(re-entry, a trap, a missing function) arrives as `Error(Context,
InvalidAction)`. That is what `try_call` hands a contract; the detail is in
the diagnostic events. A wrong return type arrives as `Ok(Err(_))`, with no
error value.

**The principle has a hole the EVM design did not have.** A hook that
exhausts the budget is not caught. The same goes for anything the hook
calls, such as a registry or the module. The whole transaction fails: the
kernel's `try` and the caller's `try` see nothing
(`a_hook_that_exhausts_the_budget_fails_the_whole_call`). The same holds for
a hook that touches a ledger entry outside the footprint
(`Error(Storage, ExceededLimit)`, also non-recoverable).

On EVM, `{gas: _hookGasLimit}` (`SquareJob.sol:434, 442, 472, 477`) cut such
a hook off and settlement went on. On Soroban no per-call limit exists to cut
it off.

**What that hole reaches.** For a job whose hook, or something the hook
calls, exhausts the budget:

- `complete` fails;
- `reject` fails, because the tolerant hook call does not help;
- `claim_refund` on a `Submitted` job with a horizon fails, because the
  probe of `resolve_payout` does not help.

Such a job cannot leave escrow until the cause is removed. A job's `hook` is
fixed at `create_job`.

**There is no in-contract defence against that, so the defence is outside
the contracts:**

- **(a) The whitelist is the trust boundary, and nothing else is.**
  `set_hook_whitelist` stays owner-only, as on EVM (`SquareJob.sol:92`). A
  hook is admitted only after its instruction cost has been measured on
  every path (c), including every contract it calls.
  - Third-party registries the hook calls run arbitrary code, and whether
    their code can change is [#49][i49]'s question. So in [#13][i13],
    `square_hook` gets owner switches that take the reputation and the
    validation write out of the settlement path.
  - On EVM, these registries are `immutable` in `SquareHook`. On Soroban, a
    registry that starts exhausting the budget would otherwise hold every job
    on this hook.
  - The switches do not touch the payout. They only drop an advisory write,
    which is what [square-hook.md](../design/square-hook.md#nothing-in-the-hook-blocks-settlement)
    already calls it.
- **(b) The keeper simulates before it sends.** The keeper runs
  `simulateTransaction` on `finalize` and `finalize_decided` before it
  submits, as the Stellar docs recommend for finding a transaction's
  resources. A simulation that fails with `Error(Budget, ExceededLimit)` is
  journaled as a held job with that reason and alerted on. It is not retried
  blindly.
  - Simulation predicts the result against the ledger as it is now. A cost
    that depends on state changing between simulation and inclusion fails
    the transaction against its declared resources.
  - The keeper re-simulates on the next tick.
  - The fee side is [#6][i6]'s.
- **(c) A measured instruction cost replaces `MIN_HOOK_GAS_LIMIT`.**
  `ComplianceModule.MIN_HOOK_GAS_LIMIT = 450_000` (`ComplianceModule.sol:127`,
  refused at construction at `:209-210`) existed because the preview and the
  check ran under one per-call cap. A cap between their two costs let the
  preview pay what the check could not book ([square#225][e225]). With no
  per-call cap that gap does not exist: a check that runs out of budget takes
  the payment down with it. The constant has no Soroban counterpart.
  - What replaces it is a documented, measured figure: the CPU instructions
    of a `finalize` with a module installed, split per path. It goes in the
    resource-fee table [#6][i6] owns. [#18][i18] measures it with
    `env.cost_estimate()`, as the probe reads the budget, and on testnet with
    `simulateTransaction`.
  - Only one part of that figure is measured today. One Groth16 verification
    costs 29,991,050 instructions (testnet simulation,
    [groth16-on-soroban.md](groth16-on-soroban.md#cost)).
  - A keeper `finalize` verifies the proof three times:
    - `proof_state` in `keeper_evaluator`;
    - `preview_release` in `resolve_payout`;
    - `check_release` in `before_action`.

    That is 89,973,150 instructions for verification alone, 22.5% of
    testnet's `txMaxInstructions` of 400,000,000. The whole path is not
    measured yet, and this page does not guess it.

**Tests:**

| EVM test | On Soroban |
|---|---|
| `contracts/test/SquareJob.t.sol` `test_hook_revertNoLongerLocksTheEscrow`, `test_reject_toleratesAHookThatReverts` (`MaliciousHook` `Revert`) | Same assertions with the panicking mock: status and ledger credits land, and one `HookFailed` is emitted. |
| `test_hook_revertBubblesTheHooksOwnErrorBeforeSettlement` | Strict call: the hook's failure fails `submit`. [#18][i18] asserts which error value reaches the caller. It was not measured here. |
| `test_hook_outOfGasIsBoundedByTheLimit` (`Loop`, on `submit`) | Inverted: the budget-eating mock makes `submit` fail with `Error(Budget, ExceededLimit)` and nothing is written. No "bounded by the limit" half is left to assert. |
| `contracts/test/SquareHook.t.sol` `test_gasLimit_aRunawayComplianceCheckCannotBlockSettlement`, `test_gasLimit_aRunawayProofStateCannotStopTheEvaluatorFromSettling` | Inverted: a module that exhausts the budget fails the whole `finalize`, and nobody is paid. A module that *panics* is still caught: the check reads as failed, or `proof_state` passes, and settlement lands. Both halves go in [#18][i18]. |
| `test_gasLimit_fitsACompliancCheckOfTheExpectedCost`, `test_gas_hookShareOfComplete` | Replaced by the instruction measurement in (c). The assertion becomes a ceiling on the measured share of `txMaxInstructions`, set by [#18][i18] from the measurement. |
| `contracts/test/ComplianceModule.t.sol:1147` `test_theUnconfirmedReportIsLostWhenTheHookFrameRunsOut` | Splits into three tests, [below](#test-plan-for-18-the-budget-exhausting-hook). The EVM outcome it pins down, "the money moved and the receipt does not say to whom", can no longer be reached through a budget. It can still be reached through a panic in `after_action` itself, outside the hook's own `try`s. |

### 6. Interface detection without ERC-165

The kernel's `create_job` detects interfaces like this:

- **Hook.** A hook must be whitelisted, as on EVM (`SquareJob.sol:58, 92`).
  The kernel checks that `hook.executable()` is `Some(Executable::Wasm(_))`.
  It then calls `try_invoke_contract(hook, "supports", [Symbol("IACPHook")])`,
  and anything but `Ok(Ok(true))` refuses the job with `InvalidHook`. The
  same call with `"IPayoutResolver"` sets `hook_resolves_payout` on
  `Ok(Ok(true))` and leaves it false otherwise.
- **Evaluator.** If `evaluator.executable()` is `Some(Executable::Wasm(_))`,
  the kernel reads `try_invoke_contract(evaluator, "settlement_horizon", [])`
  and takes `0` on any failure. Otherwise, for an account, a SAC or an
  address with nothing behind it, the horizon is `0` and **no call is
  made**.

**The `executable()` check is required.** The issue proposed calling
`settlement_horizon` on any evaluator and reading a failure as `0`. That
does not hold for an account: `probing_an_account_address_fails_the_caller` shows that a
`try_invoke_contract` on a `G…` address fails the calling contract, so
`create_job` with a human evaluator would fail outright.

| | EVM | Soroban |
|---|---|---|
| Hook implements `IACPHook` | `hook.supportsInterface(IACPHook)` (`SquareJob.sol:112`) | `supports("IACPHook")`, tried |
| Hook resolves the payout | `supportsInterface(IPayoutResolver)` (`SquareJob.sol:113`) | `supports("IPayoutResolver")`, tried |
| Evaluator horizon | `ERC165Checker` + `settlementHorizon()` (`SquareJob.sol:419-421`) | `executable()` is Wasm, then `settlement_horizon()`, tried |
| Advertising | `SquareHook.supportsInterface` (`SquareHook.sol:392`), `KeeperEvaluator.supportsInterface` (`KeeperEvaluator.sol:143`) | `square_hook.supports` answers both symbols. `keeper_evaluator` needs no `supports`, because `settlement_horizon` is itself the probe. |

**Tests:** `SquareHook.t.sol` `test_supportsBothInterfaces` becomes a test of
`supports`. [#18][i18] adds three `create_job` cases:

- an account evaluator (horizon `0`, no call);
- a contract evaluator without `settlement_horizon` (`0`);
- a hook without `supports` (`InvalidHook`).

### 7. Typed parameters per action; the proof never travels in them

`optParams` is no longer opaque bytes. Each action has its own
`#[contracttype]`: `SubmitParams { agent_id, request_hash }` and
`CompleteParams { provider_bps }`. The EVM layouts they replace:

- **`submit`:** empty or `abi.encode(uint256 agentId, bytes32 requestHash)`
  (`SquareHook.sol:243-245`).
- **`complete`:** empty (read as 10 000 bps) or
  `abi.encode(uint16 providerBps, bytes proof)` (`_decodeComplete`,
  `SquareHook.sol:451-458`).

**`CompleteParams` has no proof field.** On EVM the `proof` slot of
`complete`'s `optParams` has been ignored since [square#245][e245] and
[square#307][e307]. The proof the module reads is the one the client bound
with `setComplianceProof`, and `KeeperEvaluator` sends `bytes("")`
(`KeeperEvaluator.sol:63, 105`). On Soroban the slot does not exist. The
client binds the proof with `set_compliance_proof`, the kernel stores it,
and it reaches the hook as `ctx.compliance_proof`. A permissionless crank has
no field to put bytes in.

**What goes with the opaque bytes:**

- **The "empty `optParams` means full share" default.** `claim_refund`'s
  probe sends `CompleteParams { provider_bps: 10_000 }` explicitly.
  `IPayoutResolver`'s "must answer without `data`" contract
  ([square-hook.md](../design/square-hook.md)) becomes "must answer the
  probe's params".
- **The reserved `reject` slot.** `reject` carries only its `reason`. Adding
  a field later is an interface change, where on EVM it was not
  ([square-hook.md](../design/square-hook.md#reject)). Nothing uses the slot
  today (`KeeperEvaluator.sol:88` passes `""`).

**Tests:** these tests keep their assertions with typed arguments:

- `SquareHook.t.sol` `test_complete_aStrangerCrankingFinalizeCannotRefuseTheRelease`;
- `test_complete_finalizeCarriesNoProofAndTheJobsProofDecides`;
- `test_resolvePayout_answersTheProbeTheKernelSends`.

The first of these can no longer be written as an attack, because there is
no field to carry junk in. It stays as a check that the stored proof
decides.

## Call graph

`›` separates the contracts on the stack, outermost first. The last name is
the callee.

**Call kinds:**

- **strict:** `invoke_contract`, so the callee's failure fails the caller.
- **try:** `try_invoke_contract`, so a recoverable failure becomes a value.
  Budget exhaustion is never recoverable.

**Contract names:**

- `job`: `square_job`
- `hook`: `square_hook`
- `keeper`: `keeper_evaluator`
- `arb`: `arbitration`
- `market`: `claim_market`
- `module`: `compliance_module`
- `policy`: `policy_registry`
- `screening`: `screening_registry`
- `verifier`: `groth16_verifier`
- `usdc`: the USDC Stellar Asset Contract
- `identity`, `reputation`, `validation`: the 8004 registries the hook
  binds ([#13][i13])

**How to read the "Reentrant?" column.** It asks whether the callee is
already on the stack to its left. In every row the answer is no. Rows that
read the kernel from outside a kernel call are marked *pull, allowed*,
because the kernel is not on the stack there.

### `create_job`

Caller: anyone, who becomes the client.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | job → hook.`supports("IACPHook")` | try, only for a Wasm hook | job › hook | no | `SquareJob.sol:112` |
| 2 | job → hook.`supports("IPayoutResolver")` | try | job › hook | no | `:113` |
| 3 | job → evaluator.`settlement_horizon()` | try, only for a Wasm evaluator | job › keeper | no | `:115, 419-421` |

### `set_provider`, `set_budget`

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | job → hook.`before_action(ctx, SetProvider \| SetBudget)` | strict | job › hook | no | `SquareJob.sol:135, 150`; the hook does nothing |
| 2 | job → hook.`after_action(…)` | strict | job › hook | no | same |

### `fund`

Caller: the client; `client.require_auth()`, token flow in [#5][i5].

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | job → hook.`before_action(ctx, Fund(amount))` | strict | job › hook | no | `SquareJob.sol:163`; the hook read `getJobRecord` (`SquareHook.sol:259`), now `ctx.client`, `ctx.provider` |
| 1a | hook → module.`policy_registry()` | try | job › hook › module | no | `SquareHook.sol:279-285` |
| 1b | hook → policy.`commitment_of(client)`; `None` → `NoPolicy` | strict | job › hook › policy | no | `_pinPolicy`, `SquareHook.sol:270-277` |
| 1c | hook → screening.`is_cleared(client)`, `is_cleared(provider)` | strict | job › hook › screening | no | `SquareHook.sol:262-263` |
| 2 | job → usdc.`transfer(client, job, budget)` | strict | job › usdc | no | `safeTransferFrom`, `SquareJob.sol:184` |
| 3 | job → hook.`after_action(ctx, Fund, before)` | strict | job › hook | no | no-op |

The kernel stores `before.policy_pin` as the job's `commitment_at_fund`.

### `submit`

Caller: the provider.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | job → hook.`before_action(ctx, Submit(deliverable, params))` | strict | job › hook | no | `SquareJob.sol:188`; `getJobRecord(jobId).provider` (`SquareHook.sol:246`) is now `ctx.provider` |
| 1a | hook → identity.`owner_of(agent_id)`; `get_agent_wallet` tried | strict / try | job › hook › identity | no | `_ownsAgent`, `SquareHook.sol:460-467` |
| 1b | hook → validation.`get_validation_status(request_hash)`, when set | strict | job › hook › validation | no | `_requestBelongsTo`, `SquareHook.sol:469-472` |
| 2 | job → hook.`after_action(…)` | strict | job › hook | no | no-op |

### `set_compliance_proof`, `withdraw`, `withdraw_to`

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | `set_compliance_proof`: no external call; `client.require_auth()` | – | job | – | `SquareJob.sol:83` |
| 2 | `withdraw_to`: job → usdc.`transfer(job, to, amount)` | strict | (keeper ›) job › usdc | no | `SquareJob.sol:292` |

### `complete`, keeper path: `keeper.finalize`

Caller: anyone.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | keeper → job.`get_job_record` | strict | keeper › job | no (*pull, allowed*) | `KeeperEvaluator.sol:57, 189` |
| 2 | keeper → hook.`proof_state(proof)` | try | keeper › hook | no | `_requireDecidableProof`, `KeeperEvaluator.sol:111-120`; the hook read `complianceProofOf` (`SquareHook.sol:293`), now an argument |
| 2a | hook → module.`proof_state(proof)` | strict | keeper › hook › module | no | `SquareHook.sol:293` |
| 2b | module → verifier.`verify(…)` | try | keeper › hook › module › verifier | no | `try this.verifiedSignals` (`ComplianceModule.sol:373`), a self-call |
| 3 | keeper → job.`complete(job_id, reason, CompleteParams { provider_bps: 10_000 })`; job: `evaluator.require_auth()`, met by direct invocation | strict | keeper › job | no | `KeeperEvaluator.sol:63` |
| 3a | job → hook.`resolve_payout(ctx, params)` | strict | keeper › job › hook | no | `_resolvePayout`, `SquareJob.sol:428-437` |
| 3b | hook → market.`payee_of(job_id, ctx.provider)` | strict | keeper › job › hook › market | no | `SquareHook.sol:165` → `ClaimMarket.sol:84` → **`SquareJob.providerOf`**, reentrant, removed |
| 3c | hook → module.`preview_release(release, proof)` | try | keeper › job › hook › module | no | `try this.previewVerdict` (`SquareHook.sol:194`), a self-call; its reads of **`SquareJob`** (`:234-236`) are now `release` fields |
| 3d | module → verifier.`verify(…)` | try | … › module › verifier | no | `try this.verifiedSignals` (`ComplianceModule.sol:334`), a self-call |
| 3e | module → policy.`spent_today`, `policy_of`, `is_spender`; `commitment_of` only when there is no pin | strict | … › module › policy | no | `_bindings`; `_hookBooks` → **`SquareJob.getJobRecord`** (`:439-448`) and `_commitmentFor` → **`SquareHook.commitmentAtFund`** (`:380-381`), both reentrant, removed |
| 3f | hook → screening.`is_cleared(payee)` | try | keeper › job › hook › screening | no | `_screeningClears`, `SquareHook.sol:204-210` |
| 4 | job → hook.`before_action(ctx + payout, Complete(reason, params))` | try | keeper › job › hook | no | `_beforeHookTolerant`, `SquareJob.sol:213`; `_checkRelease`'s reads of **`SquareJob`** and **`ClaimMarket.payeeOf` → `SquareJob.providerOf`** (`SquareHook.sol:298-304`) are now `ctx` |
| 4a | hook → module.`check_release(release, proof)`; module: `registered_hook.require_auth()` | try | keeper › job › hook › module | no | `SquareHook.sol:303`, `onlyHook` |
| 4b | module → verifier.`verify(…)` | try | … › module › verifier | no | as 3d |
| 4c | module → policy.`record_spend(module, client, amount)`; policy: `spender.require_auth()` (invoker auth) and the spender must be in the spender set | try | … › module › policy | no | `ComplianceModule.sol:294` |
| 4d | hook → screening.`is_cleared(payee)`, `screening_of(payee)` | try | keeper › job › hook › screening | no | `_screeningVerdict`, `SquareHook.sol:215-220` |
| 5 | kernel state writes and ledger credits; no call | – | keeper › job | – | `SquareJob.sol:215-242` |
| 6 | job → hook.`after_action(ctx after the transition, Complete, before)` | try | keeper › job › hook | no | `_afterHookTolerant`, `SquareJob.sol:244`; `_reportUnconfirmed`, `_writeReputation`, `settlementFacts` read **`SquareJob`** (`SquareHook.sol:379-381, 486, 505`), now `ctx` |
| 6a | hook → reputation.`give_feedback(…)` | try | keeper › job › hook › reputation | no | `SquareHook.sol:480-502` |
| 6b | hook → validation.`validation_response(…)` | try | keeper › job › hook › validation | no | `_writeValidation`, `SquareHook.sol:525` |
| 7 | keeper → job.`withdrawable(keeper)`, then job.`withdraw_to(caller, fee)` → usdc | strict | keeper › job (› usdc) | no (job returned after 3) | `_forwardFee`, `KeeperEvaluator.sol:194-197` |

### `complete`, arbitration path: `keeper.finalize_decided`

Caller: anyone.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | keeper → arb.`decision(job_id)` | strict | keeper › arb | no | `KeeperEvaluator.sol:96` |
| 2 | keeper → job.`get_job_record` | strict | keeper › job | no (*pull, allowed*) | `:98` |
| 3 | keeper → hook.`proof_state(proof)`, with 2a–2b as above | try | keeper › hook › module › verifier | no | `_requireDecidableProof` |
| 4 | keeper → job.`complete(job_id, hash, CompleteParams { provider_bps: decided })`, with 3a–6b as above | strict | keeper › job › … | no | `:105` |
| 5 | keeper → arb.`settle_bond(job_id)` | strict | keeper › arb | no | `:106` |
| 5a | arb → job.`get_job_record` | strict | keeper › arb › job | no (job returned after 4) | `Arbitration.sol:135` |
| 6 | fee forward, as row 7 of the keeper path | strict | keeper › job › usdc | no | `_forwardFee` |

### `reject`

Caller: the client on `Open`, the evaluator on `Funded`/`Submitted`.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | job → hook.`before_action(ctx, Reject(reason))` | try | (arb › keeper ›) job › hook | no | `SquareJob.sol:247`; no-op |
| 2 | state write, credit to the client; no call | – | job | – | |
| 3 | job → hook.`after_action(ctx, Reject(reason), before)`; returns early if `ctx.submitted_at == 0` | try | (arb › keeper ›) job › hook | no | the hook read **`getJobRecord(jobId).submittedAt`** (`SquareHook.sol:358`), now `ctx` |
| 3a | hook → reputation.`give_feedback(−1)`, validation.`validation_response(0)` | try | … › hook › reputation / validation | no | `SquareHook.sol:360-363` |

### `vote` → decide → `apply_rejection`

Caller: an arbiter.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | arb → job.`get_job_record` | strict | arb › job | no (*pull, allowed*) | `Arbitration.sol:91, 97` |
| 2 | at threshold, `Reject`: arb → keeper.`apply_rejection(job_id, hash)`; keeper: `arbitration.require_auth()` | try | arb › keeper | no | `try _keeperEvaluator.applyRejection`, `Arbitration.sol:208` |
| 2a | keeper → job.`reject(job_id, hash)`; job: `evaluator.require_auth()`, met by direct invocation | strict | arb › keeper › job | no | `KeeperEvaluator.sol:88` |
| 2b | job → hook, with rows 1–3a of `reject` | try | arb › keeper › job › hook › reputation / validation | no | |
| 3 | the bond is credited to the disputer in `arb`'s own ledger; no call | – | arb | – | `_settleBond`, `Arbitration.sol:212, 216-221` |

### `dispute` → `open`

Caller: the client, via `keeper.dispute`; `client.require_auth()`.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | keeper → job.`get_job_record` | strict | keeper › job | no (*pull, allowed*) | `KeeperEvaluator.sol:68-80` |
| 2 | keeper → arb.`open(job_id, client, budget, resolve_by, evidence)`; arb: `keeper_evaluator.require_auth()` | strict | keeper › arb | no | `:80`; `onlyKeeperEvaluator`, `Arbitration.sol:67-70` |
| 2a | arb → usdc.`transfer(client, arb, bond)`; the client's signed tree covers it ([#5][i5]) | strict | keeper › arb › usdc | no | `safeTransferFrom`, `Arbitration.sol:84` |

### `claim_refund`

Caller: anyone.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | only for a `Submitted` job whose horizon is not 0: job → hook.`resolve_payout(ctx, CompleteParams { provider_bps: 10_000 })`, with 3b–3f of the keeper path | try | job › hook › market / module / screening | no | `_payoutResolvable`, `SquareJob.sol:275-278, 439-449` |
| 2 | credit to the client; no call | – | job | – | `:282-286` |

### `list` and `buy`

Callers: `list` by the provider; `buy` by the buyer, with `buyer.require_auth()`.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | market → job.`get_job_record` | strict | market › job | no (*pull, allowed*) | `_liveJob`, `ClaimMarket.sol:103` |
| 2 | market → keeper.`is_disputed(job_id)` | strict | market › keeper | no | `:106` |
| 3 | market → hook.`payout_market()` | try | market › hook | no | `:108`, `{gas: 50_000}` on EVM; no cap on Soroban |
| 4 | market → job.`net_payout(job_id)` | strict | market › job | no | `:38` |
| 5 | `buy` only: market → policy.`buyer_root_of(client)` | strict | market › policy | no | `ClaimMarket.sol:62` |
| 6 | `buy` only: market → usdc.`transfer(buyer, seller, price)` | strict | market › usdc | no | `:70` |

### `settle_bond`

Caller: anyone.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | arb → job.`get_job_record` | strict | arb › job | no (*pull, allowed*) | `Arbitration.sol:132-142` |

### `record_expiry`

Caller: anyone.

| # | Edge | Kind | Stack | Reentrant? | EVM |
|---|---|---|---|---|---|
| 1 | hook → job.`get_job_record` | strict | hook › job | no (*pull, allowed*: the hook is the entry point) | `SquareHook.sol:384-385` |
| 2 | hook → reputation.`give_feedback(0)` | try | hook › reputation | no | `_writeReputation` |

**Third-party code inside the graph.** `reputation`, `validation` and
`identity` run code that is not ours, while `keeper`, `job` and `hook` are on
the stack. They cannot add a reentrant edge. Any call they make to a contract
on the stack is refused by the host, and the hook's `try` catches the failure
(measured: `a_callback_into_the_kernel_is_refused_by_the_host`). What they
*can* do is exhaust the budget, which is decision 5.

### The reentrant edges of the EVM design, and where each one goes

| # | EVM edge (the callee is already on the stack) | Where | Soroban |
|---|---|---|---|
| R1 | `SquareHook.resolvePayout` → `ClaimMarket.payeeOf` → `SquareJob.providerOf` | `SquareHook.sol:165`, `ClaimMarket.sol:84` | `payee_of(job_id, ctx.provider)` (decision 2) |
| R2 | `SquareHook` → `SquareJob.complianceProofOf` inside `resolvePayout` and `_checkRelease` | `SquareHook.sol:171, 298` | `ctx.compliance_proof` |
| R3 | `SquareHook` → `this.previewVerdict` | `SquareHook.sol:194` | an internal function; the module is called through `try` (decision 4) |
| R4 | `previewVerdict` → `SquareJob.netPayout`, `paymentToken`, `getJobRecord` | `SquareHook.sol:234-236` | a `Release` built from `ctx` |
| R5 | `ComplianceModule._hookBooks` → `SquareJob.getJobRecord` | `ComplianceModule.sol:439-448` | `release.hook == registered hook` (decision 3) |
| R6 | `ComplianceModule` → `this.verifiedSignals` | `ComplianceModule.sol:334, 373` | an internal decode returning `Result`; `verifier` through `try` |
| R7 | `ComplianceModule._commitmentFor` → `SquareHook.commitmentAtFund` | `ComplianceModule.sol:380-381` | `release.commitment_at_fund` |
| R8 | `_checkRelease` → `SquareJob.netPayout`, `paymentToken`, `getJobRecord`; `ClaimMarket.payeeOf` → `SquareJob.providerOf` | `SquareHook.sol:299-304` | `ctx.payout` (the resolved split) |
| R9 | `_reportUnconfirmed` → `SquareJob.getJobRecord`, `netPayout` | `SquareHook.sol:378-381` | `ctx` after the transition |
| R10 | `_writeReputation` → `SquareJob.getJobRecord` | `SquareHook.sol:486` | `ctx` |
| R11 | `_settlementEvidence` → `this.settlementFacts` → `SquareJob.payoutOf` | `SquareHook.sol:504-513` | `ctx.payout` |
| R12 | `beforeAction(FUND)` → `SquareJob.getJobRecord` | `SquareHook.sol:259` | `ctx` |
| R13 | `beforeAction(SUBMIT)` → `SquareJob.getJobRecord` | `SquareHook.sol:246` | `ctx.provider` |
| R14 | `afterAction(REJECT)` → `SquareJob.getJobRecord` | `SquareHook.sol:358` | `ctx.submitted_at` |
| R15 | `MaliciousHook` `ReenterComplete`, `ReenterWithdraw`, `ReenterClaimRefund` → `SquareJob` (stopped by `nonReentrant`) | `contracts/test/mocks/MaliciousHook.sol`, `SquareJob.t.sol` `test_hook_reentrant*IsBlocked` | refused by the host; the kernel's `try` turns it into `HookFailed` |

One EVM edge was not reentrant but is pushed anyway:
`KeeperEvaluator._requireDecidableProof` → `hook.proofState(jobId)` →
`SquareJob.complianceProofOf` (`SquareHook.sol:291-294`). The kernel is not
on the stack there. `proof_state` takes the proof as an argument, so the hook
has one reading convention, not two.

## Types (input to [#8][i8])

A draft, not the final schema. [#8][i8] fixes the integer widths, the event
schema and the storage layout. These are the shapes the seven decisions
need. The block compiles against `soroban-sdk =27.0.6`; it was checked by
compiling it in a crate on the pinned toolchain.

- **Amounts** are `i128`, the SEP-41 amount type that [#5][i5] adopts at
  token boundaries.
- **`job_id`** is `u64`.
- **`agent_id: Option<u32>`** is the issue's proposal. [#13][i13] fixes it
  against the identity registry it binds.

```rust
use soroban_sdk::{contractclient, contracttype, Address, Bytes, BytesN, Env, Symbol};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

/// The split the kernel credits on `complete`. Present in the context of
/// `before_action` and `after_action` for `Complete`; `None` otherwise.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payout {
    pub payee: Address,
    pub provider_bps: u32,
    pub provider_share: i128,
    pub client_share: i128,
}

/// Everything the hook used to read from the kernel. Built by the kernel
/// before the transition (resolve_payout, before_action) and again after it
/// (after_action).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HookContext {
    pub job_id: u64,
    pub client: Address,
    pub provider: Option<Address>,        // unset until set_provider
    pub evaluator: Address,
    pub hook: Address,
    pub status: JobStatus,
    pub budget: i128,
    pub net_payout: i128,
    pub payment_token: Address,
    pub submitted_at: u64,                // 0 until submitted
    pub compliance_proof: Bytes,          // empty when none bound
    pub commitment_at_fund: Option<BytesN<32>>,
    pub payout: Option<Payout>,
}

/// Caller-supplied parameters of `submit`. Replaces
/// `abi.encode(uint256 agentId, bytes32 requestHash)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmitParams {
    pub agent_id: Option<u32>,
    pub request_hash: Option<BytesN<32>>,
}

/// Caller-supplied parameters of `complete`. Replaces
/// `abi.encode(uint16 providerBps, bytes proof)`. There is deliberately no
/// proof field: the proof is the client's, bound with set_compliance_proof.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompleteParams {
    pub provider_bps: u32,
}

/// The action and its arguments. Replaces `bytes4 selector` + `bytes data`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Action {
    SetProvider(Address),
    SetBudget(i128),
    Fund(i128),
    Submit(BytesN<32>, SubmitParams),     // deliverable, params
    Complete(BytesN<32>, CompleteParams), // reason, params
    Reject(BytesN<32>),                   // reason
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CheckOutcome { NotRun, Passed, Failed }

/// What before_action hands to after_action, through the kernel. Replaces
/// the transient fields. The kernel passes all-NotRun/None when a tolerant
/// before_action failed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeforeOutcome {
    pub compliance: CheckOutcome,
    pub screening: CheckOutcome,
    pub screening_commitment: Option<BytesN<32>>,
    pub policy_pin: Option<BytesN<32>>,   // set by before_action(Fund) only
}

/// What the hook asks the module about. Replaces the six loose arguments
/// of previewRelease/checkRelease, plus the two the module used to fetch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Release {
    pub job_id: u64,
    pub hook: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub client: Address,
    pub commitment_at_fund: Option<BytesN<32>>,
}

#[contractclient(name = "HookClient")]
pub trait Hook {
    fn supports(env: Env, interface: Symbol) -> bool;
    fn before_action(env: Env, ctx: HookContext, action: Action) -> BeforeOutcome;
    fn after_action(env: Env, ctx: HookContext, action: Action, before: BeforeOutcome);
    fn resolve_payout(env: Env, ctx: HookContext, params: CompleteParams) -> (Address, u32);
}

#[contractclient(name = "ComplianceClient")]
pub trait Compliance {
    fn preview_release(env: Env, release: Release, proof: Bytes) -> bool;
    fn check_release(env: Env, release: Release, proof: Bytes) -> bool;
}

#[contractclient(name = "MarketClient")]
pub trait Market {
    fn payee_of(env: Env, job_id: u64, provider: Address) -> Address;
}
```

The kernel-side entry points take the same parameter types, after the signer
argument that [auth-and-token-flow.md](auth-and-token-flow.md#who-authorizes-each-write-function)
puts first and checks against the job record:

- `submit(provider, job_id, deliverable, params: SubmitParams)`
- `complete(evaluator, job_id, reason, params: CompleteParams)`
- `reject(caller, job_id, reason)`

## The three hostile hooks, and how each ends in the kernel

These are the Soroban counterparts of `contracts/test/mocks/MaliciousHook.sol`
that [#18][i18] writes in `contracts/test-support`. The three failure modes
were measured in `call_graph_probe`: a tolerant call from the probe kernel,
and a call from the test caller for the budget case. The strict rows follow
from the SDK's documented `invoke_contract` behaviour ("Will panic if the
contract that is invoked fails or aborts in anyway. Will panic if the value
returned from the contract cannot be converted into the type T", docs.rs).

| Mock | EVM `MaliciousHook` mode | Tolerant call (`before_action`/`after_action` on `complete`, `reject`) | Strict call (`fund`, `submit`, `set_*`; `resolve_payout` in `complete`) | Probe (`claim_refund`'s `resolve_payout`; `keeper`'s `proof_state`) |
|---|---|---|---|---|
| **Panics** (`panic!` or `panic_with_error!`) | `Revert`, `ResolverReverts`; also `ReenterComplete`/`Withdraw`/`ClaimRefund`, whose refused call panics the hook | caught: `HookFailed`, the transition lands, the hook's writes and events are rolled back. **Measured:** `a_panicking_hook_is_caught_and_the_kernel_carries_on`, and `a_callback_into_the_kernel_is_refused_by_the_host` for the re-entering variant | the action fails and nothing is written; the caller retries | caught: the refund opens with `PayoutUnresolvable`, as on EVM (`test_claimRefund_opensWhenTheResolverIsDead`); `proof_state` passes and `finalize` settles |
| **Exhausts the budget** | `Loop` | **not caught**: the whole transaction fails with `Error(Budget, ExceededLimit)`. No transition, no `HookFailed`, no credit. **Measured:** `a_hook_that_exhausts_the_budget_fails_the_whole_call` | the same | the same: `claim_refund` and `finalize` fail. The job is held until the cause is removed (decision 5) |
| **Returns the wrong type** | none on EVM; closest are `BadPayee`/`BadSplit`, a well-typed but invalid answer | caught: `Ok(Err(ConversionError))` (SDK source) → `HookFailed`, the transition lands. **Measured:** `a_hook_returning_the_wrong_type_is_caught` | the action fails: `invoke_contract` panics on conversion (SDK docs) | caught: the probe reads it as unresolvable, so the refund opens |

**The resolver modes with no new mock:**

- **`BadSplit`** (`provider_bps > 10_000`): still refused by the kernel, as
  in `test_resolver_zeroPayeeAndBadSplitAreRejectedByTheKernel`.
- **`BadPayee`**: has no Soroban form. `Address` has no zero value, so a
  resolver cannot return one.
- **`StealPayout`**: stays what `test_resolver_whitelistedHookDecidesThePayee`
  says. A whitelisted hook decides the payee, and the whitelist is the trust
  boundary.

## Test plan for [#18][i18]: the budget-exhausting hook

The evidence that fixes the expected outcomes is the probe above. The tests
are written against the real `square_job` and `square_hook` with the
`test-support` mocks, using `soroban-sdk` testutils:

- `env.cost_estimate().budget().reset_default()` gives a bounded budget, as
  the probe does.
- `std::panic::catch_unwind` observes an escalated budget error.
- `try_*` client methods observe recoverable ones.

**1. A caught panic becomes `HookFailed`.** The kernel's `complete` runs with
the panicking mock as the hook.

- `try_complete` returns `Ok`.
- The job is `Completed`, and the payee's and the client's credits equal the
  split.
- One `HookFailed` event comes from the kernel.
- No event from the hook's failed frame is among the contract events.

Repeat for `reject`, and for the wrong-type mock.

**2. Budget exhaustion is not caught.** The same setup with the
budget-eating mock.

- `catch_unwind` around `try_complete` catches a panic whose message
  contains `Error(Budget, ExceededLimit)`. The client's `try_` does not
  return, as in the probe.
- A fresh read afterwards shows the job still `Submitted`, no credits, and
  `policy_registry.spent_today(client)` unchanged.

Repeat for `reject` and for `claim_refund` on an expired `Submitted` job
with a horizon. All three must fail, which is the lock decision 5 describes.

**3. The successor of
`test_theUnconfirmedReportIsLostWhenTheHookFrameRunsOut`
(`ComplianceModule.t.sol:1147`).**

Setup: a compliant proof is bound, and `record_spend` fails because the
module is not a spender. So the kernel pays and `after_action` has an
unconfirmed release to report. Three variants:

- **(a) The reputation registry panics.** The hook's own `try` catches it.
  `ReleaseUnconfirmed` is kept. There is no `HookFailed`, the provider is
  paid, and nothing is booked. This is the case the EVM test could not reach
  without losing the report.
- **(b) The reputation registry exhausts the budget.** The whole `complete`
  fails. Nothing is paid and nothing is booked, so no receipt is missing.
- **(c) `after_action` itself panics after emitting `ReleaseUnconfirmed`**,
  outside any of the hook's `try`s. There is one `HookFailed`, the provider
  is paid, nothing is booked, and the report is gone with the frame. That is
  the EVM outcome, reachable now only through a bug in the hook itself.

**4. Instruction cost.** `finalize` on a job with a module installed, with
the mock verifier replaced by `groth16_verifier` and the fixture proof. The
instruction count is read from `env.cost_estimate()` and recorded per path:
`proof_state`, `resolve_payout`, `before_action`, `after_action`. It is
checked against the testnet simulation of the same call. That measurement is
decision 5(c)'s figure.

## What the new graph settles from the EVM reading

The EVM inventory read two things that the redesign has to answer.

**The screening refusal booked a payment that was not made.**

- `resolvePayout` zeroes `providerBps` when the payee is not cleared by
  screening (`SquareHook.sol:178`).
- But `_checkRelease` computes the amount it books from the undecoded
  `optParams` split (`SquareHook.sol:297-300`).
- So a valid proof for a payee that screening refuses was consumed, and
  `recordSpend` counted the full amount against the client's day, although
  the kernel paid the provider nothing.

**On Soroban the check books what the kernel pays, and nothing else:**

- `before_action(Complete)` receives `ctx.payout`, the split the kernel
  resolved.
- The hook builds `Release.amount` from `ctx.payout.provider_share`.
- When that share is 0, the hook does not call `check_release`. Nothing is
  booked and the proof is not consumed. The compliance outcome is `Failed`
  when `CompleteParams.provider_bps` asked for a non-zero split and the
  resolver refused it, and `NotRun` otherwise.
- `after_action`'s unconfirmed report already returns early on a zero split
  (`SquareHook.sol:380`).

[#18][i18] adds a test: a valid proof for a payee screening refuses leaves
`spent_today` unchanged and the proof unconsumed.

**Entry points without a guard, and registries running under guards.** On
EVM:

- `KeeperEvaluator.applyRejection` (`KeeperEvaluator.sol:83`) has no
  `nonReentrant`;
- nor does `SquareJob.setComplianceProof` (`SquareJob.sol:83`);
- the 8004 registries run arbitrary code while `SquareJob`'s guard, and on
  `finalize` `KeeperEvaluator`'s, is held.

On Soroban, `ReentrancyGuard` is not ported. The host's rule covers every
entry point of every contract on the stack, guarded or not. That includes
`apply_rejection` while `keeper` is on the stack and `set_compliance_proof`
while `job` is.

A contract that is *not* on the stack can be called by registry code. Its
writes are protected by authorization, not by a guard:

- `set_compliance_proof` needs `client.require_auth()`;
- `apply_rejection` needs `arbitration.require_auth()`;
- `claim_market.cancel` needs the seller's auth;
- `policy_registry.record_spend` needs a registered spender's auth.

Registry code can meet a `require_auth` only for its own address or for an
address whose signed authorization covers that exact call ([#5][i5]).

The registries still run arbitrary code inside `complete`. What they can
still do is exhaust the budget, and decision 5 is the answer to that.

## Alternatives, and why each was rejected

| Alternative | Why not |
|---|---|
| **Keep the pull model and move reads to before the kernel call** (the keeper reads the job, then calls `complete`) | It covers `finalize` but not `claim_refund`, `reject` from `arbitration`, or a human evaluator's `complete`. And the kernel would still call a hook that calls back. The host refuses the callback, and a refused callback in the strict `resolve_payout` fails `complete`. |
| **Let the hook own the job's compliance state** (keep `commitment_at_fund` in the hook, have the module call the hook for it) | That is edge R7, refused while the hook is on the stack. Passing the pin as an argument costs one field. |
| **An opaque `Bytes` `data` with a Soroban XDR layout, as `optParams` was** | It keeps the property that let a permissionless crank carry bytes the module read ([square#245][e245]), and it makes the hook decode by convention what the type system can check. |
| **Symbol-based interface detection with a registry of interface ids** | ERC-165 has no Soroban standard to follow. A `supports(Symbol)` probe through `try`, behind a whitelist the owner already curates, answers the only question the kernel asks. |
| **Bounding a hook's cost inside the contract** (counting operations, or a fixed number of registry calls) | The budget the host meters is the transaction's. A contract cannot reserve part of it for the code after a call, and the probe shows that exhaustion is not catchable. A bound written in the contract would be a second, weaker estimate of what `simulateTransaction` measures exactly. |

## What this does not decide

- **The auth trees, SAC transfers and trustlines** on these edges: [#5][i5].
- **Fees, TTL and the resource-fee table** where decision 5(c)'s figure is
  recorded: [#6][i6].
- **Whether any contract here, or a registry it calls, is upgradeable**:
  [#49][i49]. It changes how much the hook admission in 5(a) can rely on a
  one-time measurement.

**Not verified here:**

- **Which error value reaches the caller** when a strict hook call fails
  with the hook's own `panic_with_error!` code. [#18][i18] asserts it.
- **The instruction cost of a whole `finalize`.** Only the verification
  share is measured.
- **The account-evaluator case with an existing account.** It was measured
  with an address that has no account entry. The host source shows the
  conversion fails for any account address, whether or not the account
  exists (`contract_id_from_address`).
- **Soroban deployments of the 8004 registries** that `square_hook` would
  bind: [#13][i13].
