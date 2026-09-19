# Porting trionlabs/stellar-8004 to soroban-sdk 27

This directory is the source of the three 8004 registries that Square's local
stack deploys (option 2 in
[docs/decisions/8004-registries-on-stellar.md](../../../docs/decisions/8004-registries-on-stellar.md),
[#33](https://github.com/Square-StellarNetwork/square-stellar/issues/33)).
On testnet, Square binds trionlabs' own deployment of the same source.

## Pins

| | Repository | Commit |
|---|---|---|
| The registries | [trionlabs/stellar-8004](https://github.com/trionlabs/stellar-8004) | [`d92c2f4ee01858b6da9bf4404ac49322c324958b`](https://github.com/trionlabs/stellar-8004/tree/d92c2f4ee01858b6da9bf4404ac49322c324958b) (`main`, 2026-07-23) |
| The OpenZeppelin crates they use | [OpenZeppelin/stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) | [`9dd85c3094321353e112a5be0e15ff44804da236`](https://github.com/OpenZeppelin/stellar-contracts/tree/9dd85c3094321353e112a5be0e15ff44804da236) (0.6.0), the `rev = "9dd85c30"` upstream's `Cargo.toml` names |

**The pinned commit is the deployed code.** Rebuilding it with upstream's own
toolchain gives the published sha256 of all three contracts, and so the
testnet and mainnet Wasm. The one proviso is the `cliver` meta string, which
records how the `stellar-cli` binary itself was built (decision record,
"The deployed code is the pinned commit").

## What is here, and whose it is

| Path | From | Licence |
|---|---|---|
| `LICENSE`, `.cargo/config.toml`, `contracts/*/src/**`, `contracts/reputation-registry/Cargo.toml`, `contracts/validation-registry/Cargo.toml` | trionlabs, unchanged | MIT (`LICENSE`) |
| `Cargo.toml`, `rust-toolchain.toml`, `contracts/identity-registry/Cargo.toml` | trionlabs, changed as listed below | MIT (`LICENSE`); the changes are offered under the same licence |
| `Cargo.lock` | generated for this workspace | |
| `openzeppelin/LICENSE`, and every `openzeppelin/packages/**` file not listed below | OpenZeppelin, unchanged | MIT (`openzeppelin/LICENSE`) |
| `openzeppelin/packages/*/Cargo.toml`, `openzeppelin/packages/tokens/src/lib.rs`, `openzeppelin/packages/tokens/src/non_fungible/mod.rs`, `openzeppelin/packages/tokens/src/non_fungible/extensions/mod.rs` | OpenZeppelin, changed as listed below | MIT (`openzeppelin/LICENSE`); the changes are offered under the same licence |
| `PORTING.md`, `interface.json`, `scripts/**`, `.gitignore` | Square | Apache-2.0 (the repository's `LICENSE`) |

**Not vendored from trionlabs:**

- `README.md`, `TECHNICAL.md` and `CONTRIBUTING.md`. The decision record cites
  them at the pinned commit.
- `Makefile`. Its targets are the two commands below. Its `verify-wasm`
  checks the SDK-25 hashes, which an SDK-27 build cannot match. Those hashes
  are in `interface.json` (`header.registries.*.published_wasm_sha256`).
- `contracts/wasm.sha256`: the same hashes.
- `contracts/*/test_snapshots/`. They are written by each test run and
  depend on the SDK version, and the repository's `.gitignore` ignores them.
- `.github/`, `.gitignore`, `skills/` and `webapp/`: upstream's CI and
  off-chain parts. Square uses none of them.

**Not vendored from OpenZeppelin:**

- the crates the registries do not use: `accounts`, `contract-utils`,
  `fee-abstraction`, `governance`, `zk-email`, and the examples;
- in `stellar-tokens`, the modules `fungible`, `rwa` and `vault`;
- the `non_fungible` extensions `consecutive`, `enumerable`, `royalties` and
  `votes`.

What is vendored is the whole of `stellar-access`, `stellar-macros` and
`stellar-event-assertion`. From `stellar-tokens` it is `non_fungible`
(`mod.rs`, `overrides.rs`, `storage.rs`, `utils/`) and its `burnable`
extension, with their tests.

## Every change, and why

No `.rs` file of trionlabs changed. `diff -r` against the pinned commit shows
only the three manifests below.

**Neither source needed an API change for `soroban-sdk` 27.0.6.** The trionlabs
code and OpenZeppelin at `9dd85c30` compile unchanged against it. Only the
dependency graph had to change: OpenZeppelin at `9dd85c30` declares
`soroban-sdk = "25.3.0"`. Taken as a git dependency, that version sits next to
27.0.6, and passing one `Env` to the other fails with `E0308`
([upgradeability-and-governance.md](../../../docs/decisions/upgradeability-and-governance.md#ownable-for-8-b1)
measured this). So the OpenZeppelin crates are vendored and built on this
workspace's SDK.

### trionlabs

| File | Upstream | Here | Why |
|---|---|---|---|
| `Cargo.toml` | `soroban-sdk = "25"` (resolves to 25.3.0) | `soroban-sdk = { version = "=27.0.6", features = ["experimental_spec_shaking_v2"] }` | The SDK Square pins ([stellar-target.md](../../../docs/decisions/stellar-target.md)). Upstream had spec shaking v2 through OpenZeppelin's workspace dependency, and its Wasm says `rssdk_spec_shaking 2`. The feature is stated here, so the spec keeps the same shape. |
| `Cargo.toml` | `stellar-tokens`, `stellar-access`, `stellar-macros`, `stellar-contract-utils` as `git = ".../stellar-contracts", rev = "9dd85c30"` | the first three as `path = "openzeppelin/packages/…"`; `stellar-contract-utils` gone | The `E0308` above. `stellar-contract-utils`: see `identity-registry/Cargo.toml` below. |
| `Cargo.toml` | `members = ["contracts/*"]` | adds `openzeppelin/packages/{access,macros,tokens,test-utils/event-assertion}` | So that `cargo test --workspace` runs OpenZeppelin's own tests of the vendored modules on this SDK too. |
| `Cargo.toml` | none | `stellar-event-assertion`, `proc-macro2`, `quote`, `syn` in `[workspace.dependencies]` | The vendored crates take these with `workspace = true`; they came from OpenZeppelin's root manifest. Same requirements as there. |
| `Cargo.toml` | `[profile.release]`, `[profile.release-with-logs]` | unchanged | The profile decides the bytes. |
| `rust-toolchain.toml` | `channel = "nightly-2025-08-11"` | `channel = "1.98.1"` | The toolchain Square pins. Nothing here needs nightly: stable 1.98.1 builds and tests it. `targets` and `components` are unchanged. |
| `contracts/identity-registry/Cargo.toml` | `stellar-contract-utils = { workspace = true }` | removed | No file of any registry uses `stellar_contract_utils`. Vendoring it would add 5,742 lines of Rust that no build reads. |
| `Cargo.lock` | resolved for SDK 25 and the git dependencies | regenerated, seeded from `contracts/Cargo.lock` | Every crate both workspaces use resolves to the same version in both: `soroban-sdk` 27.0.6, `soroban-env-host` 27.0.1, `stellar-xdr` 27.0.0, and so on. |

### OpenZeppelin

| File | Upstream | Here | Why |
|---|---|---|---|
| `packages/{access,macros,tokens,test-utils/event-assertion}/Cargo.toml` | `edition`, `license`, `repository`, `version` as `*.workspace = true` | written out: `2021`, `MIT`, the repository URL, `0.6.0` | They are members of this workspace, whose root is not OpenZeppelin's. The values are the ones OpenZeppelin's root manifest gives at the pin. |
| same | `publish = true` (access, macros, tokens) | `publish = false` | A vendored copy is never published under OpenZeppelin's crate names. |
| `packages/{access,tokens}/Cargo.toml` | `crate-type = ["lib", "cdylib"]` | `["lib"]` | `stellar contract build` builds every `cdylib` in the workspace. Only the registries are contracts. |
| `packages/tokens/Cargo.toml` | depends on `stellar-contract-utils` and `stellar-governance` | removed | Only the removed modules use them: `rwa`, `vault`, and the two `votes` extensions. |
| `packages/tokens/Cargo.toml` | dev-dependencies `ed25519-dalek`, `soroban-test-helpers`, `k256`, `p256` | removed | No test of a module kept here uses them. |
| `packages/tokens/src/lib.rs` | `pub mod fungible; pub mod non_fungible; pub mod rwa; pub mod vault;` | `pub mod non_fungible;`, and a comment | The registries use `non_fungible` only. |
| `packages/tokens/src/non_fungible/mod.rs` | `pub use extensions::{burnable, consecutive, enumerable, royalties, votes};` | `pub use extensions::burnable;`, and a comment | The same. |
| `packages/tokens/src/non_fungible/extensions/mod.rs` | five `pub mod` lines | `pub mod burnable;`, and a comment | `burnable` stays because `overrides.rs` implements `BurnableOverrides` for `Base` with its functions. |

Every other vendored OpenZeppelin file is byte-identical to the pin.

## Results

Recorded on 2026-09-19 with Rust 1.98.1 (`aarch64-apple-darwin`) and
`stellar-cli` 27.1.0.

**`cargo test --workspace --locked`: 164 tests, all pass**, run when the port
was vendored. Those test files are not in this directory any more: every one
of them authorizes with the SDK's `mock_all_auths`, and Square's repository
carries no authorization bypass, not even in vendored tests. They were removed
with their `#[cfg(test)] mod …;` lines, which changes no byte of the built
Wasm (the hashes below are the same before and after):

- `contracts/{identity,reputation,validation}-registry/src/test.rs`;
- `contracts/{reputation,validation}-registry/src/test_integration.rs`;
- `openzeppelin/packages/access/src/{ownable,role_transfer,access_control}/test.rs`;
- `openzeppelin/packages/tokens/src/non_fungible/test.rs` and
  `non_fungible/extensions/burnable/test.rs`.

In their place, CI exercises the port with real signatures:
`square_test_support::registries` registers the three Wasm files and its tests
register an agent and a validation request signed by `G…` accounts whose
signatures the host verifies (`cargo test -p square-test-support --features
registries` in `contracts/`). Together with the live-spec check below, that is
what holds the port to the deployed contracts. The record of the run at
vendoring time:

| Crate | Tests | |
|---|---:|---|
| `identity-registry` | 36 | upstream's |
| `reputation-registry` | 24 | upstream's; 2 of them against the real identity registry |
| `validation-registry` | 14 | upstream's; 1 of them against the real identity registry |
| `stellar-access` | 56 | OpenZeppelin's: ownable, role transfer, access control |
| `stellar-tokens` | 34 | OpenZeppelin's: `non_fungible`, `burnable`, `sequential` |

The 74 upstream tests are the "74 tests" of upstream's README. For
comparison, OpenZeppelin's complete `stellar-tokens` at the pin passes its
489 tests on this SDK too. That was run in a scratch build of the whole
workspace; it is not repeated here.

**`stellar contract build --locked`:**

| Wasm | Bytes | sha256 | Exported functions |
|---|---:|---|---:|
| `identity_registry.wasm` | 26,562 | `fcf0b1fa56691f507401c6cdeb3d977d6e50376ba8dc41f776d31622d2bf59f7` | 36 |
| `reputation_registry.wasm` | 19,599 | `d8f88b2a8a7fd0af5427f77a8a8fa4f5761867d88915e2401d3609869bee766f` | 20 |
| `validation_registry.wasm` | 15,360 | `9f8867429b298c8b4d8a3d386aac4022ef0940a7bba74d7ed45c883e59672a36` | 19 |

Two other builds gave the same three hashes:

- one from a copy of this directory at another path;
- one on Linux x86_64: `ubuntu:24.04` under Docker, with rustup's 1.98.1 and
  the `x86_64-unknown-linux-gnu` stellar-cli 27.1.0 tarball that
  `.github/actions/stellar-cli` installs, checked against the same sha256.

So the hashes CI prints should be these.

**The interface.** `node contracts/tools/check-8004-interface.mjs --check`
passes. Each port Wasm holds every function, type and event of the live
contract's spec, byte for byte. Beyond those, it adds:

- identity: `NonFungibleTokenError`, `OwnableError`, `RoleTransferError`;
- reputation and validation: `OwnableError`, `RoleTransferError`.

Nothing else differs. The additions come from the SDK, not from this port.
In 27.0.6, `Env::panic_with_error` calls the error type's
`spec_shaking_marker()` (`soroban-sdk-27.0.6/src/env.rs`, lines 296–302). So
every error enum raised with `panic_with_error!` is kept in the spec. In
25.3.0 it did not (`src/env.rs`, line 290), and upstream's spec drops them.
The codes are unchanged. `NonExistentToken` is still `Error(Contract, #200)`,
now also named in the spec.

**On a real network.** The three Wasm above were deployed to testnet by a
throwaway owner, with the constructors as in the decision record. The rows of
the interface table were then called the way the hook and the CLI call them:

- identity `CC4DIMSCBIG5YZOCECYANOJNWDANUYTAAGTQOXCXYO747UZ3N2HLD5AO`, tx `021c9078…`;
- reputation `CDXOLHZIJY322WWRZD4RGMYLP44QJHZZX4EWBVSY5GWIM5RI7C7Z5OHQ`;
- validation `CCEF4AAL6YNRXI7F7WKSXM4RTICROSCD7K3VWIORNSNJT55TIKVSKRKN`.

The first three rows were also called on trionlabs' deployment, with the same
results. The feedback and validation writes were not repeated on those shared
registries; for them, the reference is upstream's source and tests.

| Call | Result |
|---|---|
| `register_with_uri` (the smoke card) | returned `0`; emitted `mint`, `metadata_set` (`agentWallet`, 56 bytes), `registered`; tx `f01d6c89…` |
| `owner_of`, `get_agent_wallet`, `get_metadata("agentWallet")`, `token_uri` | the owner, the owner, the owner's StrKey in ASCII, the card URI |
| `owner_of` / `find_owner` of an unminted id | `Error(Contract, #200)` / `None` |
| `give_feedback(client, 0, 1, 0, "square", "completed", "", "", hash)`, the call the hook makes on a completion | ok; `new_feedback` with `tag1` as a topic; `read_feedback` and `get_last_index` read it back; tx `2fb93f20…` |
| `give_feedback` by the agent's owner | `Error(Contract, #1)` (`SelfFeedback`) |
| `validation_request`, then `validation_response(…, 100, "", hash, "square.settlement")` by the validator | both ok; `get_validation_status` goes from `has_response: false` to `true`, response 100; txs `87e2ce1e…`, `3536bae4…` |
| `validation_response` by anyone else / `validation_request` with a used hash | `Error(Contract, #5)` / `Error(Contract, #4)` |
| `propose_upgrade` by the owner | ok, and **no event**; `pending_upgrade()` then returns the proposal; tx `4ab6975a…` |
| `execute_upgrade` at once | `Error(Contract, #10)` (`TimelockNotExpired`) |

Then `check-8004-interface.mjs --watch` was pointed at that identity registry.
It reported the pending upgrade and the ledger it becomes executable at
(`4764970 + 51840 = 4816810`), and it exited 1.

The same sequence ran against the local network Square's stack uses. That is
the pinned quickstart image
`stellar/quickstart:v649-b1276.1-testing@sha256:0ff11d40…` with `--local`:
Protocol 27, stellar-rpc 27.1.1. Every row of the table above came out the
same, error codes included. The contracts were:

- identity `CB6PBNT4HLSWSC3OVWVVTFR4BUCWSGDCMCKEEKMRBTFN3CCRAMFFKJJH`;
- reputation `CALS3ITRFC4LHDDSPVTDN55NOFJNV45QKB23BSVIPNU6STEKGSKWATIA`;
- validation `CBUBUA7T27O4QPTQCH6JTC4ILIGQGCCCSIWYP6WSETOML5FV4WA2LNQD`.

These ids change with every fresh local network.

**Why a byte-for-byte comparison with an untrimmed build is not the test.** A
scratch build against OpenZeppelin's complete, untrimmed packages behaves as
follows:

- reputation and validation come out byte-identical to the Wasm above;
- identity's contract spec is byte-identical too, but its code section is not.

Identity is the one registry that links `stellar-tokens`, and its code bytes
move with incidental inputs. Four builds that differed only in those gave
four hashes (`fcf0b1fa…` here, `2664875d…`, `a0b54580…`, `772ef881…`), all
with the same spec section:

- where the crates sit;
- their crate metadata;
- how much other code `stellar-tokens` holds.

What pins its behaviour is:

- the tests above;
- upstream's own tests;
- the testnet run.

## Build, test, check

```console
$ cd contracts/vendor/stellar-8004
$ stellar contract build --locked
$ cd ../.. && cargo test --locked -p square-test-support --features registries
$ cd .. && node contracts/tools/check-8004-interface.mjs --check
```

`.github/workflows/stellar-8004.yml` runs the same three on pull requests
that touch this directory, and weekly.

## Moving to a new upstream commit

1. Diff the new commit's `Cargo.toml` against the pin, for the SDK version
   and the OpenZeppelin revision.
2. Replace `contracts/*/src` and the unchanged files from the new commit.
   Re-apply the three manifest changes above.
3. If the OpenZeppelin revision moved, vendor the same file set from it and
   re-apply its changes. If the registries now use more of it, vendor that
   too, and list it here.
4. Run upstream's own tests on the new commit in a scratch checkout (they use
   `mock_all_auths`, so their files are not vendored), then
   `stellar contract build --locked` here and the registries tests above.
5. In `interface.json`'s header, update `upstream.commit`, the published
   hashes and, if they changed, the contract ids.
6. Run `node contracts/tools/check-8004-interface.mjs` to write the generated
   half and the decision's table, then run it with `--check`.
7. Record the new results in this file.
