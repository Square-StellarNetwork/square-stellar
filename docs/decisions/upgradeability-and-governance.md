# Upgradeability and governance: no contract can replace its code, the owner is a multisig account

**Status:** decided in [#49][i49]. It is an input to the storage and event schema
and the shared crate in [#8][i8] (B1), to every contract issue from [#9][i9] to
[#17][i17], to the contract tests in [#18][i18] (B11) and to the deploy scripts in
[#19][i19] (B12). It also blocks [#50][i50] (B13). The TTL numbers it relies on
are in [fees-and-ttl.md](fees-and-ttl.md) ([#6][i6]). The checks and the upstream
sources below were read on 2026-09-19.

[i6]: https://github.com/Square-StellarNetwork/square-stellar/issues/6
[i8]: https://github.com/Square-StellarNetwork/square-stellar/issues/8
[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9
[i10]: https://github.com/Square-StellarNetwork/square-stellar/issues/10
[i11]: https://github.com/Square-StellarNetwork/square-stellar/issues/11
[i12]: https://github.com/Square-StellarNetwork/square-stellar/issues/12
[i13]: https://github.com/Square-StellarNetwork/square-stellar/issues/13
[i14]: https://github.com/Square-StellarNetwork/square-stellar/issues/14
[i15]: https://github.com/Square-StellarNetwork/square-stellar/issues/15
[i16]: https://github.com/Square-StellarNetwork/square-stellar/issues/16
[i17]: https://github.com/Square-StellarNetwork/square-stellar/issues/17
[i18]: https://github.com/Square-StellarNetwork/square-stellar/issues/18
[i19]: https://github.com/Square-StellarNetwork/square-stellar/issues/19
[i33]: https://github.com/Square-StellarNetwork/square-stellar/issues/33
[i37]: https://github.com/Square-StellarNetwork/square-stellar/issues/37
[i44]: https://github.com/Square-StellarNetwork/square-stellar/issues/44
[i47]: https://github.com/Square-StellarNetwork/square-stellar/issues/47
[i49]: https://github.com/Square-StellarNetwork/square-stellar/issues/49
[i50]: https://github.com/Square-StellarNetwork/square-stellar/issues/50
[i54]: https://github.com/Square-StellarNetwork/square-stellar/issues/54

[deployer]: https://docs.rs/soroban-sdk/27.0.6/soroban_sdk/deploy/struct.Deployer.html
[oz-upgradeable]: https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/contract-utils/src/upgradeable
[oz-ownable]: https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/access/src/ownable/storage.rs
[multisig]: https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig
[operations]: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
[soroban-auth]: https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization
[archival]: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival
[persisting]: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/persisting-data
[cli-extend]: https://developers.stellar.org/docs/tools/cli/cookbook/extend-contract-instance
[horizon-account]: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object

## The decision

1. **No contract can replace its own code.** None of the nine contracts
   (`square_job`, `keeper_evaluator`, `arbitration`, `claim_market`,
   `square_hook`, `policy_registry`, `compliance_module`, `groth16_verifier`,
   `screening_registry`) calls `update_current_contract_wasm`, and none exports
   an upgrade function. A fix is a new deployment. That is option 3 below: the
   escrow contracts are immutable, and the side contracts are immutable too but
   can be swapped out through the owner setters the EVM design already has.
   Moving to a timelocked upgrade (option 2) needs its own decision record.
2. **CI enforces it** on every built Wasm, by the Wasm's imports and not by
   function names ([below](#the-ci-check)).
3. **Ownership is a small two-step owner in `square-common`**
   ([#8][i8]). It follows the semantics of OpenZeppelin's
   `stellar-access::ownable` but does not depend on that crate: the published
   release cannot be linked against this workspace's `soroban-sdk`
   ([below](#ownable-for-8-b1)).
4. **`renounce_ownership` is disabled in `policy_registry` and
   `screening_registry`**, as `PolicyRegistry.sol:145` and
   `ScreeningRegistry.sol:90` disable it on the EVM.
5. **On testnet the owner of every contract is one classic `G…` account with a
   2-of-3 weighted multisig**, configured with `set_options` by the deploy script
   ([#19][i19]). On mainnet only the signers change. The contracts never see the
   difference.
6. **The keeper ([#37][i37]) keeps the code and instance TTLs of the nine
   contracts alive**, and the `contractTtlLow` alarm ([#47][i47]) fires when
   one runs low. Nothing about TTL needs the owner.

## What is different on Soroban

On the EVM the contracts were immutable by default. Every fix was a new
deployment and a new address. There were three redeploys in three days,
recorded in [redeploy-2026-09-08.md](../deploy/redeploy-2026-09-08.md) and
[redeploy-2026-09-09.md](../deploy/redeploy-2026-09-09.md), and
[docs/deploy/README.md](../deploy/README.md) is the checklist they produced.
The owner was the deployer; ownership was offered to `OWNER` through
`Ownable2Step` when it was set (redeploy-2026-09-08.md, "a Safe takes over when
`OWNER` is set").

On Soroban, immutability has to be chosen. Two facts make it a choice:

- **A contract can replace its own Wasm.** `soroban-sdk` 27.0.6 has
  [`Deployer::update_current_contract_wasm`][deployer]: it "replaces the
  executable of the current contract with the provided Wasm. The Wasm blob
  identified by the `wasm_hash` has to be already present in the ledger". The
  change takes effect "after the invocation has successfully finished". Who may
  trigger it is up to the contract's own authorization logic. A contract that
  never calls it cannot change its code.
- **Code and instance expire.** Contract code and contract instances have TTLs.
  When one is archived, "it can't be loaded to execute your invocations"
  ([state archival][archival]).

## Options

| | Option | For | Against |
|---|---|---|---|
| 1 | **Immutable.** No contract exposes an upgrade. A fix is a new deployment plus a new record ([docs/deploy/README.md](../deploy/README.md)). | Same trust model as the EVM. Smallest attack surface. Docs and indexer keep "address = version". | Frequent testnet redeploys; testnet resets force these anyway ([#54][i54]). Escrow stays in the old contract and must be swept (the runbook exists, see [below](#rotation-runbooks)). |
| 2 | **Timelocked upgrade.** An `upgrade(e, new_wasm_hash, operator)` entry point, as in OpenZeppelin's [`Upgradeable`][oz-upgradeable] trait, behind a timelock (OpenZeppelin `stellar-governance`, for example `TimelockController`). The owner proposes, the change applies after the delay, and the pending upgrade is announced by an event. | Emergency fixes keep the address. Users get a window to object. | On an escrow contract an upgrade means "the owner can write code that moves the funds". The indexer and the SDK must track versions. Migration risk: OpenZeppelin's module says it does **not** check that the new Wasm lacks a constructor, keeps upgradeability or keeps storage consistent, and "all access control and authorization checks are the implementor's responsibility". The published crate has the same SDK conflict as `stellar-access` ([below](#ownable-for-8-b1)). |
| 3 | **Hybrid, in effect immutable plus rotation.** The escrow holders `square_job`, `arbitration` and `claim_market` are immutable. The side contracts (`policy_registry`, `screening_registry`, `compliance_module`, `square_hook`, `groth16_verifier`) are also immutable. They are swapped out through the owner setters the EVM design already has (`set_compliance_module`, `set_screening`, `set_hook_whitelist`, `set_hook`, `set_spender`). | Matches the EVM design one to one. No upgrade code is ever written. | The rotation runbooks have to be written ([below](#rotation-runbooks)). |

**Chosen: option 3.** The kernel holds escrow, and its trust model is "the hook
informs, it cannot veto" ([hook-failure-modes.md](hook-failure-modes.md)). That
model means nothing if the owner can change the kernel's code. Option 3 keeps it
and writes no upgrade code at all.

A dependency that *can* upgrade is a different risk: we cannot rule it out by
our own CI. Issue #49 records that the Stellar ERC-8004 registries use a
timelocked upgrade. This page does not re-verify that; it belongs to
[#33][i33] (E2).

## The CI check

`contracts/tools/check-no-upgrade.mjs` reads each built Wasm. It fails any Wasm
that **imports** the `update_current_contract_wasm` host function, and also any
Wasm that exports a function whose name looks like an upgrade (`upgrade`,
`migrat…`, `set_wasm`, `update_wasm`, `update_code`).

- **Why imports and not exports.** #49 asked for a check of the exported
  function list (`stellar contract inspect`). The import is stronger. A contract
  can replace its Wasm only through that host function, whatever the exported
  function is called.
- **Where the import name comes from.** Host functions are imported under short
  module and field names. The tool does not hard-code them. It resolves
  `soroban-env-common` through `cargo metadata --locked` and reads that crate's
  `env.json`, so the check follows the pinned SDK. In `soroban-env-common`
  27.0.1, which `soroban-sdk =27.0.6` resolves to, the entry is export `"6"` of
  module `"l"`, documented as "Replaces the executable of the current contract
  with the provided Wasm code identified by a hash".
- **CI.** The job `soroban workspace (build, test, bindings, no upgrade)` in
  `.github/workflows/contracts.yml` runs `node tools/check-no-upgrade.mjs`
  right after `stellar contract build` (step "No contract can replace its own
  code"). It is listed in [docs/ci.md](../ci.md).

Run locally on 2026-09-19, first against the nine skeletons, then against a
sample contract whose only function, `replace_code(env, hash)`, calls
`env.deployer().update_current_contract_wasm(hash)`. The name `replace_code`
matches none of the upgrade-shaped patterns, so the failure comes from the
import alone:

```console
$ node tools/check-no-upgrade.mjs
update_current_contract_wasm is import ("l", "6") in soroban-env-common 27.0.1
ok   target/wasm32v1-none/release/arbitration.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/claim_market.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/compliance_module.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/groth16_verifier.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/keeper_evaluator.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/policy_registry.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/screening_registry.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/square_hook.wasm: 0 exported function(s), no update_current_contract_wasm import
ok   target/wasm32v1-none/release/square_job.wasm: 0 exported function(s), no update_current_contract_wasm import
exit=0

$ node tools/check-no-upgrade.mjs upgradeable_sample.wasm
update_current_contract_wasm is import ("l", "6") in soroban-env-common 27.0.1
FAIL upgradeable_sample.wasm: imports update_current_contract_wasm

1 Wasm file(s) can upgrade; see docs/decisions/upgradeability-and-governance.md
exit=1
```

The skeletons export no functions yet. The check becomes meaningful as each
B-cluster issue fills its contract in, and it runs on every one of those changes.

**Deployed Wasm.** The check above covers what the repository builds. The same
tool accepts Wasm paths, so a deployed contract is checked by fetching its code
first. `stellar-cli` 27.1.0 has `stellar contract fetch --id <C…> -o <file>`.
The deployed-code job `check:deployed-wasm` runs `stellar contract fetch` and
compares the sha256 against the deployment record. It is listed for
[#19][i19] (B12) in [foundry-to-soroban.md](../upstream/foundry-to-soroban.md),
and #49 places it with [#44][i44] (H2). Whichever lands it runs
`check-no-upgrade.mjs` on the fetched files as well. Neither job exists yet.

## Owner authority, per contract

Every owner function reads the stored owner and calls `owner.require_auth()`.
The owner is never a function argument. The table maps the EVM admin functions
(`contracts/src/*.sol`) to the Soroban names already used in
[auth-and-token-flow.md](auth-and-token-flow.md). Delays and bounds are the EVM
ones: the port changes none of them. On top of these, every contract with an
owner has `transfer_ownership` and `accept_ownership` from `square-common`
([below](#ownable-for-8-b1)).

| Contract (issue) | Owner functions (EVM source) | Delay or limit | `renounce_ownership` |
|---|---|---|---|
| `square_job` ([#9][i9]) | `set_fees` (`setFees`, L63), `set_hook_whitelist` (`setHookWhitelist`, L92), `skim` (`skim`, L75) | New fee bps apply after `FEE_NOTICE` = 1 day (L21), and a new call restarts the notice. The treasury changes immediately. `set_hook_whitelist` is immediate, and existing jobs keep their hook. `skim` moves only balance − total withdrawable − total escrowed. | enabled (EVM: inherited, not overridden) |
| `keeper_evaluator` ([#14][i14]) | `configure_windows` (L40), `set_finalize_grace` (L44), `set_arbitration` (L49) | The window setters append a window that takes effect now; a job keeps the settlement horizon it snapshotted at creation. `set_arbitration` can be called once. | enabled |
| `arbitration` ([#15][i15]) | `set_arbiters` (L48), `set_bond_parameters` (L63) | `set_arbiters` creates a new set version, and open disputes keep theirs. Limits: 1–255 arbiters, 0 < threshold ≤ n. `set_bond_parameters` is immediate and applies to future disputes only; bps ≤ 10 000. | enabled |
| `claim_market` ([#16][i16]) | none: `ClaimMarket.sol` has no owner | — | — |
| `square_hook` ([#13][i13]) | `set_compliance_module` (L119), `set_screening` (L129), `set_reputation_policy` (L134) | All immediate. A zero screening address removes screening. | enabled |
| `compliance_module` ([#12][i12]) | `set_hook` (L228, refuses zero), `set_timestamp_tolerance` (L234) | immediate | enabled |
| `groth16_verifier` ([#10][i10]) | none: `Groth16Verifier.sol` has no owner | — | — |
| `policy_registry` ([#11][i11]) | `set_spender` (L193, refuses zero) | immediate. The owner cannot touch anyone's policy: `set_policy` and `set_buyer_root` are authorized by the poster. | **disabled** (L145) |
| `screening_registry` ([#17][i17]) | `set_screener` (L79, refuses zero), `set_max_age` (L86) | `max_age` must be between 1 minute and 7 days; both setters are immediate | **disabled** (L90) |

No new timelock is added. [travel-rule.md](../design/travel-rule.md) notes that
`setComplianceModule` has none. Its answer is that the
`ComplianceModuleUpdated` event history is the timeline, and that answer carries
over. The protection the EVM design lacked, a single deployer key, is replaced
by the multisig below.

### The "non-owner cannot call" tests

Each contract's test suite ([#18][i18] (B11), written in the contract's own
issue) has, for **every** owner function in the table:

- **The refusal.** The contract is registered with owner `O`. The function is
  called with authorization mocked for a different address `N` only (the SDK's
  `Env::mock_auths`). The `try_` call must fail.
- **The positive twin.** `O` calls the function, and `env.auths()` must show
  exactly `O` authorizing that invocation. Without this, a test run under
  `mock_all_auths` would pass whoever the function asked for. The twin is what
  proves the function asks the stored owner.

On top of these:

- **Every owned contract** tests that `N` cannot call `transfer_ownership`.
- **`keeper_evaluator`** tests that `O`'s second `set_arbitration` fails.
- **`policy_registry` and `screening_registry`** test that `O`'s own
  `renounce_ownership` fails and ownership is unchanged. If the entry point is
  not exported at all, the tests assert the bindings have no such function.
- **The owner primitive in `square-common`** is tested once, there:
  - only the pending owner accepts;
  - an offer past its expiry ledger cannot be accepted;
  - an offer with expiry 0 cancels;
  - renounce is refused while a transfer is pending.

## Ownable for #8 (B1)

**Constraint, measured.** The published OpenZeppelin crates (`stellar-access`,
`stellar-contract-utils`; newest on crates.io is 0.7.2, released 2026-06-09)
require `soroban-sdk ^26.1.0`. This workspace pins `=27.0.6`
([stellar-target.md](stellar-target.md)). Here is a crate with both, calling
`stellar_access::ownable::set_owner` from its constructor:

```console
$ cargo tree -d -e normal | grep soroban-sdk
soroban-sdk v26.1.1 (*)
soroban-sdk v27.0.6 (*)
$ cargo check
error[E0308]: arguments to this function are incorrect
    |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ----  ------ expected `soroban_sdk::address::Address`, found `soroban_sdk::Address`
    |                                            expected `soroban_sdk::env::Env`, found `Env`
note: there are multiple different versions of crate `soroban_sdk` in the dependency graph
error: could not compile `ozcheck` (lib) due to 1 previous error
```

[foundry-to-soroban.md](../upstream/foundry-to-soroban.md#openzeppelin-on-soroban)
records the same result.

**The alternatives that remain:**

- **A git dependency on OpenZeppelin `main`.** At commit `a5bd8cb`
  (2026-09-18), `main` declares `soroban-sdk = { version = "27.0.2", features =
  ["experimental_spec_shaking_v2"] }`, and its crates still say version 0.7.1.
  - It is not a release. The GitHub tags after 0.7.2 are `v0.8.0-rc.1` to
    `v0.8.0-rc.3`, all marked pre-release. The newest, `v0.8.0-rc.3`, still
    declares `soroban-sdk` 26.1.0. None of them is on crates.io. A pin would
    name an arbitrary commit, and an audit would have to cover that commit.
  - `stellar-access` takes `soroban-sdk` with `workspace = true`, so it inherits
    that feature. Cargo unifies features, so the dependency would switch
    `experimental_spec_shaking_v2` on for our own `soroban-sdk`. That changes
    how all nine contracts are built. The feature exists in `soroban-sdk`
    27.0.6's manifest.
  - Cargo's rules say `^27.0.2` admits 27.0.6. A build with this dependency was
    not attempted.
- **A small owner in `square-common`.** About the size of the code it replaces,
  with no new dependency, and built by the same pinned SDK as everything else.

**Chosen: the owner in `square-common`**, written in [#8][i8]. It follows
OpenZeppelin's semantics
([`ownable/storage.rs` at `a5bd8cb`][oz-ownable]), so that a later switch to a
crates.io release built on our SDK line is mechanical. That switch would be a
separate change.

- **Storage.** The owner is stored in instance storage, as OpenZeppelin does, so
  its TTL is the instance's ([TTL](#ttl-responsibility)).
- **Setting the owner.** It is set once, from `__constructor`. OpenZeppelin's
  `set_owner` "lacks authorization checks" and is meant for the constructor
  only; ours is the same.
- **`transfer_ownership(new_owner, live_until_ledger)`.** Owner auth. It
  replaces any pending offer. A `live_until_ledger` of 0 cancels.
- **`accept_ownership()`.** Pending-owner auth, and only up to
  `live_until_ledger`.
- **`renounce_ownership()`.** A helper that a contract exports only where the
  table says "enabled". It is refused while a transfer is pending, as in
  OpenZeppelin (`TransferInProgress`).
- **Events.** Their names and data are fixed in the [#8][i8] event schema.
- **No upgrade.** The crate provides no upgrade helper. A contract that wants
  one has to call `update_current_contract_wasm` itself, and CI refuses that.

## Rotation runbooks

The runbooks that exist today are written for the EVM stack (Arcscan, `forge`).
They are rewritten for Stellar in [docs/deploy/README.md](../deploy/README.md)
by [#19][i19] (B12), which owns the deploy scripts and is blocked by this
decision. This page names the runbooks and their sources; it does not write
them.

| Runbook | Exists today | Must say at least |
|---|---|---|
| **Supersede the stack** (a new kernel means new everything) | [docs/deploy/README.md §3 "After the deploy"](../deploy/README.md#3-after-the-deploy) step 2, and [contracts/README.md "Superseding a deployment"](../../contracts/README.md#superseding-a-deployment) | the sweep: finalize or reject every `Submitted` job, `withdraw` every balance, `skim` what no ledger entry claims, then check that the old kernel's balance reads zero |
| **Addresses and read-back after any change** | [docs/deploy/README.md §2](../deploy/README.md#2-addresses-the-two-sources-and-their-readers) and §3 step 1 | the reads that prove the wiring: `is_spender(compliance_module)`, `compliance_module()`, `screening()`, `is_screener(…)` |
| **Replace the compliance module** | no; the ordering constraints are in [compliance-gate.md, "When the preview said yes and the check could not"](../design/compliance-gate.md#when-the-preview-said-yes-and-the-check-could-not) | `square_hook.set_compliance_module`, `compliance_module.set_hook` and `policy_registry.set_spender` in an order that fails closed; jobs on an old hook are paid nothing |
| **Replace the hook** | no | `square_job.set_hook_whitelist(new, true)`: existing jobs keep their hook, so the old one stays whitelisted until they settle, and `compliance_module.set_hook(new)` must follow |
| **Replace the verifier** (a new key, for example after the phase-2 ceremony in [zk-setup-status.md](../disclosure/zk-setup-status.md)) | no | the module's verifier is fixed at construction (`_verifier` is immutable on the EVM), so a new verifier means a new `compliance_module`, then the module runbook |
| **Replace the screening registry or a screener** | no; §2 of docs/deploy/README.md has the `isScreener` read | `square_hook.set_screening`, `screening_registry.set_screener`; a registry with no screener clears nobody |
| **Rotate the arbiter set** | no; the version rule is in [storage-and-events.md](../design/storage-and-events.md) | `arbitration.set_arbiters`; open disputes keep the version they opened with |
| **Rotate the owner's signers** | no; the signer list lives in `docs/deploy/testnet.md`, which [#19][i19] creates | the `set_options` procedure below, applied to one signer at a time |
| **Restore an archived contract** | no | [fees-and-ttl.md](fees-and-ttl.md) owns the restore flow |

The contracts fix some references at construction. On the EVM these are the
immutables:

- `ClaimMarket.sol:19-22` holds the kernel, the evaluator, the token and the
  policy registry.
- `SquareHook.sol:26-31` holds the kernel, the token, the market and the three
  ERC-8004 registries.
- `ComplianceModule.sol:129-131` holds the verifier, the registry and the
  kernel.
- `Arbitration.sol:18-20` holds the token, the evaluator and the kernel.

As long as the Soroban contracts keep them fixed in `__constructor`, replacing a
contract that others hold forces those others to be replaced too. For example, a new `policy_registry` means a
new `compliance_module` and a new `claim_market`, and so a new `square_hook`.
Each runbook has to follow that chain to its end.

## TTL responsibility

Each of the nine contracts has two entries that must stay live: its code
(`ContractCode`) and its instance. Instance storage "shares a single TTL" with
the instance ([state archival][archival]), and that includes the owner and every
setting in the owner table.

- **Who extends.** The keeper ([#37][i37]) periodically extends the code and
  instance TTL of all nine. `stellar contract extend --id <C…>` covers "the
  contract instance itself", its instance entries and "the contract's Wasm
  code" ([CLI cookbook][cli-extend]). Owner transactions extend the instance
  TTL as well, as [#6][i6] proposes.
- **No privilege needed.** "There is no access control for TTL extension
  operations. Any user may invoke `ExtendFootprintTTLOp` on any LedgerEntry"
  ([persisting data][persisting]). The owner is not needed, and if the keeper
  stops, anyone can take over.
- **The alarm.** `contractTtlLow` ([#47][i47]) fires when the remaining TTL of
  any of these code or instance entries falls below the threshold in
  [fees-and-ttl.md](fees-and-ttl.md).
- **Why it matters more here.** No contract can upgrade, so an archived code
  entry cannot be worked around by pointing the contract at other code. The
  contract is unusable until that entry is restored.
- **What lives in [fees-and-ttl.md](fees-and-ttl.md).** The thresholds,
  `extend_to`, who pays the XLM, and the restore flow. This page fixes only who
  is responsible.

## Testnet owner: a 2-of-3 classic multisig

**Why a classic account.** A classic account has weighted signers and low,
medium and high thresholds natively. Each threshold is 0–255, and "if this sum
is equal to or greater than the threshold for that operation type, then the
operation is authorized" ([multisig][multisig]). Soroban's `require_auth` on a
`G…` address "supports the Stellar multisig with medium threshold"
([authorization][soroban-auth]). So every owner function in the table works
unchanged, whatever signers stand behind the account. The owner's address never
changes, so no `transfer_ownership` is needed to reach mainnet. Only the
signers change.

OpenZeppelin `stellar-accounts` (a smart account with signers and policies) and
`stellar-governance` are alternatives. They are not used: at 0.7.2 on crates.io
both require `soroban-sdk ^26.1.0`, the same conflict as `stellar-access`, and
the classic account needs no code.

**The procedure [#19][i19] puts in the deploy script.** It uses
`stellar tx new set-options`, which takes `--signer` and `--signer-weight`
(weight 0 deletes the signer), `--master-weight`, `--low-threshold`,
`--med-threshold` and `--high-threshold` (all 0–255). A `SetOptions` operation
carries one signer. Changing signers or thresholds needs the **high** threshold
([list of operations][operations]). A new account starts with every threshold
at 0 and the master key at weight 1 ([multisig][multisig]).

1. **Deploy with the master key.** The owner account `G_OWNER` is the deployer.
   Every constructor receives `G_OWNER` as the owner. The deploy and the wiring
   are signed by its master key.
2. **Read back.** Check the parameters and the wiring
   ([docs/deploy/README.md §3](../deploy/README.md#3-after-the-deploy)) before
   step 3, while one key can still fix a mistake.
3. **Add the three signers.** Three transactions, each signed by the master
   key, which weighs 1 against thresholds of 0:
   - `set-options --signer <G_SIGNER_1> --signer-weight 1`
   - the same with `<G_SIGNER_2>`
   - the same with `<G_SIGNER_3>`
4. **Retire the master key and set the thresholds.** One last transaction,
   signed by the master key:
   `set-options --master-weight 0 --low-threshold 2 --med-threshold 2 --high-threshold 2`.
   From then on any two of the three signers together weigh 2, and that meets
   every threshold. One signer alone does not. The master key signs nothing:
   "if the master key's weight is set at 0, it cannot be used to sign
   transactions" ([multisig][multisig]).
   - This must be the last step. Before it, the three signers must already
     exist, or the account is locked for good.
5. **Verify.** Read `GET /accounts/G_OWNER` from Horizon. Expect `signers`
   (`key`, `weight`) to list the three signers at weight 1 and the master at 0,
   and `thresholds` to read `low_threshold`, `med_threshold` and
   `high_threshold` = 2 ([account object][horizon-account]). Write the read-back
   into the deploy record.
6. **Prove it works.** Make one owner call signed by two signers, built with
   `--build-only`, then `stellar tx sign` twice and `stellar tx send`, and
   record it as B12's evidence.
   - Also try the same call with one signature and record that it is refused.
   - This page has not run either call. #19 is where the medium-threshold rule
     is shown working against a deployed contract.

**Signer rotation** later uses the same operation. Add the new signer at weight
1, then remove the old one at weight 0. Each step is a high-threshold
transaction signed by two current signers. Two signers must stay available
throughout.

**Where the signers are recorded.** The three signer public keys (`G…`) live in
`docs/deploy/testnet.md`, which [#19][i19] creates when it generates the keys.
The repository records keys and roles, never who holds a key, and never a
secret seed. No signer keys exist yet, so none are written here.
