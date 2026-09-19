# 8004 registries on Stellar: trionlabs' deployment on testnet, the same source built by us locally

**Status:** decided in [#33][i33]. Binds the hook in [#13][i13], the resolver
in [#34][i34], the CLI in [#30][i30], the deploy scripts in [#19][i19] and the
smoke agents in [#35][i35]. The measurements below are from 2026-09-19.

[i13]: https://github.com/Square-StellarNetwork/square-stellar/issues/13
[i19]: https://github.com/Square-StellarNetwork/square-stellar/issues/19
[i30]: https://github.com/Square-StellarNetwork/square-stellar/issues/30
[i32]: https://github.com/Square-StellarNetwork/square-stellar/issues/32
[i33]: https://github.com/Square-StellarNetwork/square-stellar/issues/33
[i34]: https://github.com/Square-StellarNetwork/square-stellar/issues/34
[i35]: https://github.com/Square-StellarNetwork/square-stellar/issues/35
[i36]: https://github.com/Square-StellarNetwork/square-stellar/issues/36
[i37]: https://github.com/Square-StellarNetwork/square-stellar/issues/37
[i43]: https://github.com/Square-StellarNetwork/square-stellar/issues/43
[i49]: https://github.com/Square-StellarNetwork/square-stellar/issues/49
[i54]: https://github.com/Square-StellarNetwork/square-stellar/issues/54
[up]: https://github.com/trionlabs/stellar-8004
[pin]: https://github.com/trionlabs/stellar-8004/tree/d92c2f4ee01858b6da9bf4404ac49322c324958b
[readme]: https://github.com/trionlabs/stellar-8004/blob/d92c2f4ee01858b6da9bf4404ac49322c324958b/README.md
[technical]: https://github.com/trionlabs/stellar-8004/blob/d92c2f4ee01858b6da9bf4404ac49322c324958b/TECHNICAL.md

On Arc the three ERC-8004 registries were the chain's own single deployment.
Stellar has no official one. The one in use is a third-party port,
[trionlabs/stellar-8004][up] (MIT): three Soroban contracts, a TypeScript SDK,
a CLI, an indexer and an explorer, deployed on testnet and on mainnet.

## The decision

1. **Testnet: Square binds trionlabs' deployment** (option 1 below). The hook,
   the resolver, the CLI and the smoke agents use these three contracts:

   | Registry | Testnet contract |
   |---|---|
   | Identity | `CDE3K4COIAGWNNJQQLL26SYI3KBJF5FUDHXG5FA6GYDJCG7T5V7FIWZH` |
   | Reputation | `CBZEAGIEI3HXMDRLF44KLQJQQOH6LCYWWSGJVSYQYQO2HQ6DDGZ7HT55` |
   | Validation | `CC5USZRO26MOIAVNYTTJDS63C2OBBLREOAOET4CPF2EZWO3YFKLMO3SL` |

   They are written once, in the `header` of
   `contracts/vendor/stellar-8004/interface.json`. Everything else reads them
   from there.
2. **The local stack deploys the same source, built by us** (option 2). It is
   vendored at upstream commit
   [`d92c2f4ee01858b6da9bf4404ac49322c324958b`][pin] in
   `contracts/vendor/stellar-8004/` and ported to `soroban-sdk =27.0.6` and
   Rust 1.98.1. It is its own Cargo workspace, and
   `contracts/vendor/stellar-8004/PORTING.md` lists every change. [#19][i19]
   deploys it from `deploy-local.sh`, so the local stack runs the real
   registries' code.
3. **The interface is pinned to the live contract spec, not to memory.** The
   [table below](#the-interface) is rendered from the spec that
   `stellar contract fetch` downloads from the three testnet contracts.
   `contracts/tools/check-8004-interface.mjs --check` fails CI when that spec,
   the table, or the port's spec stop matching
   (`.github/workflows/stellar-8004.yml`).
4. **The upgrade risk is accepted on testnet, and watched.** The registries'
   owner is one account. It can replace the code of all three, 51,840 ledgers
   (3.0 days) after proposing it. The keeper and the indexer poll
   `pending_upgrade()` and alarm on it ([the watch](#the-watch)).
5. **Mainnet is not decided here.** A separate issue decides it, with its own
   assessment of the upgrade risk. [What it has to weigh](#mainnet) is listed
   below.
6. **The resolver tells the deployments apart by registry.** A `did:aip` names
   its identity registry ([#32][i32]). On testnet that is trionlabs', locally
   ours. `allowedRegistries` in the resolver ([#34][i34]) lists each network's
   registry.

## Options

| | Option | For | Against |
|---|---|---|---|
| 1 | **Use trionlabs' deployment** (the testnet and mainnet ids in upstream's README) | The same registries as the ecosystem: the explorer at stellar8004.com, `@trionlabs/stellar8004`, x402 agents. Nothing to deploy. An agent registered once is visible to every 8004 client. | A third party can **upgrade** it after a 3-day timelock, and its owner is a single key ([below](#owners-and-the-upgrade-path)). Adoption is low: 3 GitHub stars; 29 agents on testnet after our two, 68 on mainnet. Built with `soroban-sdk` 25. |
| 2 | **Our own deployment of the same MIT source**, ported to `soroban-sdk` 27 | We are the owner, so we control versions. The local stack needs it anyway. | A registry apart from the ecosystem: agents registered there are invisible to other 8004 clients. DIDs name a different `registry`. We would carry the owner key, and the TTL of every entry. |
| 3 | **A minimal port of our own** (only the functions the hook calls) | The smallest surface. | The claim to be 8004 compatible weakens. The resolver could not resolve agents in any other registry. It is a third implementation to keep in step with the standard. |

**Chosen:** 1 on testnet, 2 on the local stack; mainnet later. Three reasons:

- An 8004 identity is only worth what others can read. On testnet the
  ecosystem's registry is trionlabs'.
- The upgrade risk is real but visible. `pending_upgrade()` announces a change
  three days before it can happen, and a changed Wasm hash is detected by CI
  ([the watch](#the-watch)).
- Option 2 costs nothing extra on the local stack, where the code has to be
  built anyway. Running the same source as testnet means the local stack tests
  against the code the hook meets on testnet.

## What was verified, and where

### The upstream project

| Claim (issue #33) | Found | Source |
|---|---|---|
| MIT, 3 stars, last push 2026-08-01 | MIT; 3 stars; `pushed_at` 2026-08-01T21:47:26Z. That push went to a branch: `main`'s head is `d92c2f4` of 2026-07-23. | GitHub API, `repos/trionlabs/stellar-8004` and its `commits` |
| Three Soroban contracts, SDK, CLI, indexer, explorer | Yes: `contracts/{identity,reputation,validation}-registry`, `webapp/packages/sdk`, `webapp/packages/indexer`, stellar8004.com | [README][readme] |
| The testnet and mainnet contract ids | As in the table above, and the mainnet ids below. Upstream's single source for them agrees: `webapp/packages/sdk/src/core/config.ts`. | [README][readme], `config.ts` at the pin |
| Reproducible build, published sha256 | Yes, with one caveat on the CLI build ([below](#the-deployed-code-is-the-pinned-commit)) | `contracts/wasm.sha256` at the pin |
| Spec coverage: Identity 11/11, Reputation 8/10 (`readAllFeedback` off chain), Validation 7/7 | As upstream states it. It was not re-counted here against the EVM reference contracts. What Square calls is in [the table](#the-interface), and that is checked. | [TECHNICAL.md][technical] |
| `register` / `register_with_uri` / `register_full` | Yes | live spec |
| `set_agent_wallet` needs both the caller's and the wallet's `require_auth()` | Yes: `caller.require_auth(); new_wallet.require_auth();` | `contracts/identity-registry/src/contract.rs` at the pin |
| Agent id is `u32` | Yes: `owner_of(token_id: u32)`, `get_metadata(agent_id: u32, …)` | live spec |
| `agentWallet` is a reserved metadata key, read through `get_metadata` | Yes, and it is refused by `set_metadata` and `register_full`. Live reads: `get_metadata(id, "agentWallet")` is 56 bytes of ASCII, equal to `get_agent_wallet(id)`, for agents 0, 1, 26, 27 and 28. | `contract.rs` lines 13–15 (the key), 94–97 and 157–159 (refused), 171–178 (read); testnet simulation |
| A transfer deletes all metadata | Yes: the wallet and every metadata key; the agent URI stays. Upstream's `test_transfer_clears_metadata` passes on the port. | `IdentityBase::transfer` in `contract.rs` |
| Event topic layouts | As in [the table](#the-interface). The first topic is always the event name as a `Symbol`, and the data is a map. | live spec; events of the smoke run |
| OpenZeppelin two-step ownership | Yes: `transfer_ownership(new_owner, live_until_ledger)`, then `accept_ownership()` | live spec |
| 3-day timelocked upgrade (`propose_upgrade`/`execute_upgrade`) | Yes: `TIMELOCK_LEDGERS = 51_840`, plus `cancel_upgrade` and `pending_upgrade` | `storage.rs` of each contract; live spec |
| `soroban-sdk` 25.3.0, OpenZeppelin at a pinned commit | Yes: `Cargo.lock` resolves `soroban-sdk` 25.3.0. OpenZeppelin `stellar-contracts` is at `9dd85c3094321353e112a5be0e15ff44804da236` (0.6.0). The deployed Wasm's meta says `rssdkver 25.3.0#dcbea445…`, `rsver 1.91.0-nightly`, `cliver 25.2.0#`. | `Cargo.lock`; `stellar contract info meta` |

`reputation.get_identity_registry()` and `validation.get_identity_registry()`
both return the identity registry above, on testnet and on mainnet.

### The deployed code is the pinned commit

The three testnet contracts were fetched, and so were the three mainnet
contracts through two public providers (`https://mainnet.sorobanrpc.com`,
`https://rpc.lightsail.network/`). All six hash to upstream's published
values:

```console
$ stellar contract fetch --id CDE3K4COIAGWNNJQQLL26SYI3KBJF5FUDHXG5FA6GYDJCG7T5V7FIWZH --network testnet -o identity.wasm
$ shasum -a 256 *.wasm
f25af88f3e26f603a6569b2554b3f85ccc8af9a88f3b904fba873637c64eb2ab  identity.wasm
74af1a031934346260f7265dacb633209dba507c1416f1e37d52405b53478f71  reputation.wasm
9e5d7dc78ca00fc7c7afc914a0b3ecbcec61b4e7b1893a84bf47c3b811c68aa1  validation.wasm
```

| Registry | Mainnet contract | sha256 (testnet and mainnet) |
|---|---|---|
| Identity | `CBGPDCJIHQ32G42BE7F2CIT3YW6XRN5ED6GQJHCRZSNAYH6TGMCL6X35` | `f25af88f…4eb2ab` |
| Reputation | `CBOIAIMMWAXI57OATLX6BWVDQLCC4YU55HV6MZXFRP6CBSGAMXSTEPPA` | `74af1a03…478f71` |
| Validation | `CBT6WWEVEPT2UFGFGVJJ7ELYGLQAGRYSVGDTGMCJTRWXOH27MWUO7UJG` | `9e5d7dc7…c68aa1` |

**Rebuilding the pin gives the same bytes, except one meta string.** The pin
was rebuilt with upstream's own toolchain: `nightly-2025-08-11` and
`stellar-cli` 25.2.0 (the release binary, whose attestation verifies, and
again from crates.io). `make build` did not give the published hashes. A
section-by-section comparison shows why. Every section is byte-identical:
code, data, spec, env meta, SDK meta. The one exception is the custom section
holding the CLI's `cliver` string:

| | `cliver` in the Wasm |
|---|---|
| Deployed | `25.2.0#` (no git revision) |
| Rebuilt with the release binary or a crates.io build | `25.2.0#28484880988199233a7e8e87c97cb12dac323cb3` |

Putting the deployed 43-byte section in place of the rebuilt one gives
exactly `f25af88f…`, `74af1a03…` and `9e5d7dc7…`. The deployer's
`stellar-cli` was built without VCS information. A "fresh checkout +
`make build`" reproduces the code, and reproduces the hash only with such a
CLI build. **So the source vendored here is the code deployed on testnet and
mainnet.** This matters beyond provenance: the storage layout
[#34][i34] reads is taken from that source.

### Owners and the upgrade path

| | Testnet | Mainnet |
|---|---|---|
| `get_owner()` of all three registries | `GCCWEPP2MFAUF5HWICYGXDVPBVSHFQWSLQOAMNARLDQIWC2AZVGNRSQV` | `GC7KDXELLWGGHQY5MREUKGD2A3LLCEJUWUZZFOZWVGFFW6C2GC6FQKQW` |
| That account's signers (Horizon) | itself only, weight 1, thresholds 0/0/0 | itself only, weight 1, thresholds 0/0/0 |
| `pending_upgrade()` | `None` on all three | `None` on all three |
| `version()` | `0.1.0` | `0.1.0` |
| `total_agents()` | 29 (27 before the smoke run below) | 68 |

- **One key upgrades.** `propose_upgrade`, `execute_upgrade` and
  `cancel_upgrade` are `#[only_owner]`. That expands to OpenZeppelin's
  `enforce_owner_auth`: read the owner from instance storage, then
  `owner.require_auth()`. The owner is a single-signer account on both
  networks.
- **The timelock.** `execute_upgrade` succeeds once
  `ledger - proposed_at >= 51_840`. The average close time over the last 200
  ledgers, from Horizon, was 5.0 s on both networks. So the timelock is 3.0
  days.
- **What the proposal is not.** `propose_upgrade` writes
  `DataKey::PendingUpgrade` to instance storage and emits **no event**. Only
  the view, or a scan of transactions, shows it.
- **What the execution is.** `execute_upgrade` calls
  `update_current_contract_wasm` (import `l.6` in all three Wasm files). The
  host then emits a system event,
  `["executable_update", old_executable, new_executable]`
  (`soroban-env-host` 27.0.1, `src/events/system_events.rs`). Testnet RPC
  accepts `getEvents` with `type: "system"` on these contract ids.
- **Ownership moves in two steps and announces itself.**
  `transfer_ownership` emits `OwnershipTransfer`, `accept_ownership` emits
  `OwnershipTransferCompleted`, and `renounce_ownership` emits
  `OwnershipRenounced`. After a renounce, no upgrade can ever be proposed.

## The interface

This is what the hook ([#13][i13]), the resolver ([#34][i34]) and the CLI
([#30][i30]) call, exactly as the live spec declares it. Two things are
generated from a Wasm's spec rather than written from this table:

- **`@squaresdk/core`'s bindings** in `packages/core/src/registry-bindings/`,
  which `packages/core/scripts/generate-8004-bindings.mjs` writes from the live
  Wasm it fetches and holds to the published hashes. The `stellar-8004`
  workflow runs it with `--check`.
- **The contracts' tests** register the port's own Wasm through
  `square_test_support::registries` (feature `registries`), whose clients
  `contractimport!` generates from that Wasm's spec. The port holds every live
  entry byte for byte (below), so the calls are the live ones.

**How the table stays true.** `contracts/tools/check-8004-interface.mjs`
does the following for each registry in `interface.json`'s header:

- `stellar contract fetch`es the Wasm, hashes it, and reads its spec with
  `stellar contract info interface --output json`;
- writes the whole normalised spec to `interface.json` (`generated`), and
  renders the rows the header names into the region below.

With `--check` it does the fetch again, and fails on any of these:

- the spec differs from `interface.json`;
- the table differs from the rendering;
- the Wasm hash differs from the published one;
- an upgrade is pending;
- the owner changed;
- the port's spec lacks any live entry, or holds one differently.

**Encodings to get right:**

- **Agent ids are `u32`**, and the first id is 0. The EVM's
  `_boundAgentPlusOne` trick is not needed: an `Option<u32>` says "not bound"
  ([#13][i13]).
- **`get_metadata(id, "agentWallet")`** returns the wallet's StrKey as
  **ASCII bytes**: 56 bytes for a `G…` or `C…` address, not the 32-byte key.
  The code is `address_to_strkey_bytes` in `storage.rs`, lines 7–14. To compare
  it with an `Address`, call `get_agent_wallet` instead. It returns the same
  wallet as an `Address`. Registration sets the wallet to the owner. A
  transfer or `unset_agent_wallet` clears it, and then both reads return
  `None`.
- **A missing agent traps some calls and not others.** `owner_of` and
  `token_uri` trap with `Error(Contract, #200)`. That is OpenZeppelin's
  `NonFungibleTokenError::NonExistentToken`, raised with `panic_with_error!`.
  Upstream built with `soroban-sdk` 25.3.0, so the error enum is **not in the
  live spec**, although the code is. `find_owner`, `get_metadata` and
  `get_agent_wallet` return `None` instead. `agent_uri` returns
  `Error(Contract, #2)` (`UriNotSet`). All six were simulated on testnet for
  id 29, the first id not minted after the smoke run below.
- **Events.** The first topic is the event name as a `Symbol`, snake case.
  The remaining topics are the `#[topic]` fields, in order. The data is an
  `ScMap` from each remaining field's name, as a `Symbol`, to its value
  (`data_format: map`). `MetadataSet`'s `key` topic is a `String`, not a
  `Symbol`.
- **Errors are contract errors** with the numbers in the type tables. The
  hook calls the registries through `try_invoke_contract`
  ([call-graph-on-soroban.md](call-graph-on-soroban.md)). To the caller, a
  function that returns `Err(e)` and one that raises `e` with
  `panic_with_error!` look the same:
  - `Err(Ok(e))` when the hook's error type can hold the code;
  - `Err(Err(InvokeError::Contract(code)))` when it cannot. That applies to
    `#200`, for instance, unless the hook's error type is
    `soroban_sdk::Error`.

  A panic that carries no error value arrives as
  `Err(Err(InvokeError::Abort))`. So do `register_full`'s `assert!`s and
  other host failures (`soroban-sdk-27.0.6/src/env.rs` `try_invoke_contract`,
  `src/error.rs` `InvokeError`). Budget exhaustion is the exception: it is
  not caught, and it fails the whole transaction
  ([call-graph-on-soroban.md](call-graph-on-soroban.md)).
- **Writes carry their caller.** Unlike `giveFeedback(agentId, …)` on the EVM,
  every write takes `caller: Address` first and calls `caller.require_auth()`.
  The hook passes its own address, and a contract authorizes calls it makes
  directly.

**What a registration emits,** observed in the smoke run
(transaction `d5ec98ae…`, agent 28):

| # | Topics | Data |
|---|---|---|
| 1 | `Symbol("mint")`, `Address(owner)` | `{ token_id: U32(28) }` |
| 2 | `Symbol("metadata_set")`, `U32(28)`, `String("agentWallet")` | `{ value: Bytes(56 ASCII bytes of the owner's G…) }` |
| 3 | `Symbol("registered")`, `U32(28)`, `Address(owner)` | `{ agent_uri: String("") }` |

**The id of a registration is the transaction's return value** (`u32`).
`getTransaction` returns it, and it cannot be taken by a concurrent
registration the way the EVM simulation's could. So the CLI ([#30][i30]) can
read it from there, rather than from an event as on the EVM. The `registered`
event carries the same id, and the smoke script checks that the two agree.

**Reading the table.**

- In the Topics column, the quoted first entry is the event name, sent as a
  `Symbol`. The rest are the typed topic fields.
- "map" in the Data column means an `ScMap` keyed by the listed field names.
- A struct value is also an `ScMap` keyed by its field names. The spec lists
  the fields in that key order, which is why they are alphabetical.
- Each registry's rows are those `interface.json` names. The file holds the
  full spec: 49 entries for identity, 30 for reputation, 28 for validation.

<!-- BEGIN interface table: rendered by contracts/tools/check-8004-interface.mjs from interface.json; do not edit by hand -->

#### Identity registry, `CDE3K4COIAGWNNJQQLL26SYI3KBJF5FUDHXG5FA6GYDJCG7T5V7FIWZH`

| Function | Used by | Notes |
|---|---|---|
| `register(caller: Address) -> u32` | CLI (#30); smoke agent without a card (#35) | Auth: `caller`. Mints the next id to `caller` (ids start at 0) and sets its `agentWallet` to `caller`. The id is the transaction's return value. |
| `register_with_uri(caller: Address, agent_uri: String) -> u32` | CLI (#30); smoke agent with a card (#35) | As `register`, and stores `agent_uri`, which `token_uri` then returns. |
| `register_full(caller: Address, agent_uri: String, metadata: Vec<MetadataEntry>) -> u32` | CLI (#30) | As `register_with_uri`, plus at most 100 `MetadataEntry`s. A reserved `agentWallet` key, a key over 64 bytes or a value over 4096 bytes panics; it is not an error code. |
| `owner_of(token_id: u32) -> Address` | hook (#13); resolver (#34) | Traps with `Error(Contract, #200)` (`NonExistentToken`) for an id that was never minted. |
| `find_owner(agent_id: u32) -> Option<Address>` | hook (#13) | `None` for an id that was never minted: the form of `owner_of` that does not trap. |
| `get_metadata(agent_id: u32, key: String) -> Option<Bytes>` | hook (#13); resolver (#34) | With key `agentWallet`: the wallet's StrKey as ASCII bytes, 56 for a `G…` or `C…` address; `None` when unset or for an unminted id. Any other key: the bytes stored by `set_metadata`. |
| `get_agent_wallet(agent_id: u32) -> Option<Address>` | hook (#13); resolver (#34) | The same wallet as an `Address`; `None` when unset or for an unminted id. |
| `token_uri(token_id: u32) -> String` | resolver (#34) | The stored agent URI, or `""` if none was set. Traps with `#200` for an id that was never minted. |
| `get_owner() -> Option<Address>` | upgrade watch | The one account that can `propose_upgrade`, `execute_upgrade` and `cancel_upgrade`. |
| `pending_upgrade() -> Option<UpgradeProposal>` | upgrade watch | `Some` from `propose_upgrade` until `execute_upgrade` or `cancel_upgrade`. `execute_upgrade` succeeds 51,840 ledgers after `proposed_at`. |

| Event | Topics | Data | Notes |
|---|---|---|---|
| `Mint` | `"mint"`, `to: Address` | map: `token_id: u32` | From every `register*`, first. OpenZeppelin's event. |
| `MetadataSet` | `"metadata_set"`, `agent_id: u32`, `key: String` | map: `value: Bytes` | From every `register*` with key `agentWallet` and the owner's StrKey bytes, then once per entry of `register_full`; from `set_metadata`, `set_agent_wallet`; from `unset_agent_wallet`, `transfer` and `transfer_from` with key `agentWallet` and an empty value. |
| `Registered` | `"registered"`, `agent_id: u32`, `owner: Address` | map: `agent_uri: String` | From every `register*`, last; `agent_uri` is `""` for `register`. |
| `UriUpdated` | `"uri_updated"`, `agent_id: u32`, `updated_by: Address` | map: `new_uri: String` | From `set_agent_uri`. |
| `Transfer` | `"transfer"`, `from: Address`, `to: Address` | map: `token_id: u32` | From `transfer` and `transfer_from`, which first delete the wallet and every metadata entry of the agent. OpenZeppelin's event. |
| `OwnershipTransfer` | `"ownership_transfer"` | map: `old_owner: Address`, `new_owner: Address`, `live_until_ledger: u32` | The registry owner offered ownership to `new_owner` (upgrade watch). |
| `OwnershipTransferCompleted` | `"ownership_transfer_completed"` | map: `new_owner: Address` | `new_owner` accepted: it can now propose upgrades (upgrade watch). |
| `OwnershipRenounced` | `"ownership_renounced"` | map: `old_owner: Address` | No owner any more: no upgrade can be proposed again (upgrade watch). |

| Type | Definition |
|---|---|
| `UpgradeProposal` | `struct { proposed_at: u32, wasm_hash: BytesN<32> }` |
| `MetadataEntry` | `struct { key: String, value: Bytes }` |

#### Reputation registry, `CBZEAGIEI3HXMDRLF44KLQJQQOH6LCYWWSGJVSYQYQO2HQ6DDGZ7HT55`

| Function | Used by | Notes |
|---|---|---|
| `give_feedback(caller: Address, agent_id: u32, value: i128, value_decimals: u32, tag1: String, tag2: String, endpoint: String, feedback_uri: String, feedback_hash: BytesN<32>) -> Result<(), ReputationError>` | hook (#13) | Auth: `caller`; the hook passes its own address and authorizes as the direct invoker. Errors: `SelfFeedback` (#1) if `caller` owns or is approved for the agent, `InvalidValueDecimals` (#3) above 18, `AgentNotFound` (#6), `ValueOutOfRange` (#8) above 10^38 in absolute value. |
| `read_feedback(agent_id: u32, client_address: Address, feedback_index: u64) -> Result<FeedbackData, ReputationError>` | hook tests (#13, #18) | Feedback indices start at 1. `FeedbackNotFound` (#2) for an index not written. |
| `get_last_index(agent_id: u32, client_address: Address) -> u64` | hook tests (#13, #18) | 0 until `client_address` first gives feedback to the agent. |
| `get_owner() -> Option<Address>` | upgrade watch | As on the identity registry. |
| `pending_upgrade() -> Option<UpgradeProposal>` | upgrade watch | As on the identity registry. |

| Event | Topics | Data | Notes |
|---|---|---|---|
| `NewFeedback` | `"new_feedback"`, `agent_id: u32`, `client_address: Address`, `tag1: String` | map: `feedback_index: u64`, `value: i128`, `value_decimals: u32`, `tag2: String`, `endpoint: String`, `feedback_uri: String`, `feedback_hash: BytesN<32>` | From `give_feedback`; `feedback_index` is the new `get_last_index`. |
| `OwnershipTransfer` | `"ownership_transfer"` | map: `old_owner: Address`, `new_owner: Address`, `live_until_ledger: u32` | Upgrade watch. |
| `OwnershipTransferCompleted` | `"ownership_transfer_completed"` | map: `new_owner: Address` | Upgrade watch. |
| `OwnershipRenounced` | `"ownership_renounced"` | map: `old_owner: Address` | Upgrade watch. |

| Type | Definition |
|---|---|
| `ReputationError` | `error: SelfFeedback = 1, FeedbackNotFound = 2, InvalidValueDecimals = 3, NotOwnerOrApproved = 4, AggregateOverflow = 5, AgentNotFound = 6, EmptyValue = 7, ValueOutOfRange = 8, ClientAddressesRequired = 9, NoUpgradeProposed = 10, TimelockNotExpired = 11, UpgradeAlreadyProposed = 12` |
| `UpgradeProposal` | `struct { proposed_at: u32, wasm_hash: BytesN<32> }` |
| `FeedbackData` | `struct { is_revoked: bool, tag1: String, tag2: String, value: i128, value_decimals: u32 }` |

#### Validation registry, `CC5USZRO26MOIAVNYTTJDS63C2OBBLREOAOET4CPF2EZWO3YFKLMO3SL`

| Function | Used by | Notes |
|---|---|---|
| `validation_request(caller: Address, validator_address: Address, agent_id: u32, request_uri: String, request_hash: BytesN<32>) -> Result<(), ValidationError>` | provider, before a `submit` that binds an agent (#13) | Auth: `caller`, who must own or be approved for the agent (`NotOwnerOrApproved`, #1). `AgentNotFound` (#7). `request_hash` must be new (`RequestAlreadyExists`, #4). |
| `validation_response(caller: Address, request_hash: BytesN<32>, response: u32, response_uri: String, response_hash: BytesN<32>, tag: String) -> Result<(), ValidationError>` | hook (#13) | Auth: `caller`, who must be the request's `validator_address` (`NotDesignatedValidator`, #5). `response` at most 100 (`InvalidResponse`, #3). Repeatable: a later response replaces the earlier one. |
| `get_validation_status(request_hash: BytesN<32>) -> Result<ValidationStatus, ValidationError>` | hook (#13) | `RequestNotFound` (#2) for an unknown hash. Before any response, `has_response` is false and `response` is 0. |
| `get_owner() -> Option<Address>` | upgrade watch | As on the identity registry. |
| `pending_upgrade() -> Option<UpgradeProposal>` | upgrade watch | As on the identity registry. |

| Event | Topics | Data | Notes |
|---|---|---|---|
| `ValidationRequest` | `"validation_request"`, `validator_address: Address`, `agent_id: u32`, `request_hash: BytesN<32>` | map: `request_uri: String` | From `validation_request`. |
| `ValidationResponse` | `"validation_response"`, `validator_address: Address`, `agent_id: u32`, `request_hash: BytesN<32>` | map: `response: u32`, `response_uri: String`, `response_hash: BytesN<32>`, `tag: String` | From every `validation_response`. |
| `OwnershipTransfer` | `"ownership_transfer"` | map: `old_owner: Address`, `new_owner: Address`, `live_until_ledger: u32` | Upgrade watch. |
| `OwnershipTransferCompleted` | `"ownership_transfer_completed"` | map: `new_owner: Address` | Upgrade watch. |
| `OwnershipRenounced` | `"ownership_renounced"` | map: `old_owner: Address` | Upgrade watch. |

| Type | Definition |
|---|---|
| `ValidationError` | `error: NotOwnerOrApproved = 1, RequestNotFound = 2, InvalidResponse = 3, RequestAlreadyExists = 4, NotDesignatedValidator = 5, AlreadyResponded = 6, AgentNotFound = 7, CounterOverflow = 8, NoUpgradeProposed = 9, TimelockNotExpired = 10, UpgradeAlreadyProposed = 11` |
| `UpgradeProposal` | `struct { proposed_at: u32, wasm_hash: BytesN<32> }` |
| `ValidationStatus` | `struct { agent_id: u32, has_response: bool, last_update: u64, response: u32, response_hash: BytesN<32>, tag: String, validator_address: Address }` |

<!-- END interface table -->

### Storage layout, for single-ledger reads

[#34][i34] reads an agent in one `getLedgerEntries` call so that its answer
belongs to one ledger. Storage keys are not part of a contract spec. These
come from the pinned source, which [is the deployed code](#the-deployed-code-is-the-pinned-commit).
Each was read from the testnet identity registry for agent 0 with
`stellar contract read --key-xdr`:

| Read | Persistent key (`ScVal`) | Value | Defined in |
|---|---|---|---|
| owner (`owner_of`, `find_owner`) | `Vec[Symbol("Owner"), U32(id)]` | `Address` | OpenZeppelin `NFTStorageKey::Owner` (`openzeppelin/packages/tokens/src/non_fungible/storage.rs`) |
| agent wallet (`get_agent_wallet`, and `get_metadata("agentWallet")` as StrKey bytes) | `Vec[Symbol("AgentWallet"), U32(id)]` | `Address` | `DataKey::AgentWallet` (`contracts/identity-registry/src/storage.rs`) |
| agent URI (`token_uri`, `agent_uri`) | `Vec[Symbol("AgentUri"), U32(id)]` | `String` | `DataKey::AgentUri` |
| other metadata | `Vec[Symbol("Metadata"), U32(id), String(key)]` | `Bytes` | `DataKey::Metadata` |
| metadata key list | `Vec[Symbol("MetadataKeys"), U32(id)]` | `Vec<String>` | `DataKey::MetadataKeys` |
| balance | `Vec[Symbol("Balance"), Address(owner)]` | `u32` | `NFTStorageKey::Balance` |

These rules follow from the source:

- A missing `Owner` entry means the id was never minted.
- A missing `AgentUri` entry makes `token_uri` return `""`.
- An archived entry, one whose `liveUntilLedgerSeq` has passed, is not a
  missing one. [#34][i34] reports it as `archived`, not `notFound`.
- Every read the contract itself makes extends the entry's TTL. The
  registry's own entries use a threshold of 518,400 ledgers and a bump of
  1,036,800 (`storage.rs`). OpenZeppelin's `Owner` and `Balance` use 501,120
  and 518,400. A simulated read extends nothing.

## Upgrade risk and the watch

### What an upgrade could do to Square

A new Wasm can change any function's behaviour, its interface or the storage
layout. It would apply to all agents at once, and Square cannot veto it. Per
consumer:

- **Hook ([#13][i13]).** `before_action(submit)` binds an agent only if
  `owner_of` or the `agentWallet` names the provider, and the request's
  `validator_address` is the hook. A hostile registry could bind the wrong
  agent, or refuse every binding. Reputation and validation writes go through
  `try_invoke_contract`, so a registry that fails loses the record and does
  not block settlement. A registry that exhausts the budget fails the whole
  transaction. The defence is the owner switch that takes these writes out of
  the settlement path ([hook-failure-modes.md](hook-failure-modes.md)).
- **Resolver ([#34][i34]).** It reports what the registry says: controller,
  wallet, card. A new storage layout breaks a single-ledger read built on
  [the keys below](#storage-layout-for-single-ledger-reads). Reads through
  the functions keep working as long as their signatures do.
- **CLI ([#30][i30]) and smoke agents ([#35][i35]).** Registrations stay, as
  far as a new Wasm keeps the storage. The smoke checks would fail loudly.

The hook's registry addresses are fixed at construction, as the EVM
immutables were ([upgradeability-and-governance.md](upgradeability-and-governance.md)).
So leaving trionlabs' deployment means a new `square_hook`, through the
"Replace the hook" runbook there.

### The watch

The issue asks the keeper and the indexer to watch `pending_upgrade`. Upstream
emits no event for a proposal, so polling the view is the only way to see one
before it executes.

| Who | What | How often | Alarm |
|---|---|---|---|
| Keeper ([#37][i37]) | `pending_upgrade()` on the three registries, by `simulateTransaction`: read-only, and it needs no signature and no fee. It compares `get_owner()` and the instance's Wasm hash with `interface.json`. | Every 720 ledgers (about an hour), well inside the 51,840-ledger timelock | A critical health check through `@squaresdk/observability`. `/health` fails, naming the registry, the proposed Wasm hash and the ledger it becomes executable at (`proposed_at + 51,840`). |
| Indexer ([#36][i36]) | `getEvents` on the three contract ids, for `executable_update` (`type: "system"`) and for `ownership_transfer`, `ownership_transfer_completed` and `ownership_renounced` | Its normal cursor | The same alert, and the event is kept. RPC keeps events for 7 days (`ledgerRetentionWindow` 120,960), so the cursor must not fall behind by more than that. |
| CI (`.github/workflows/stellar-8004.yml`) | `check-8004-interface.mjs --watch`: live Wasm hash against the published one, `get_owner()` against `interface.json`, and `pending_upgrade()` | Daily. The full `--check` runs weekly and on pull requests. | The run fails. Until the keeper and indexer checks exist, this is the backstop. |

**On an alarm, within the timelock:**

1. Fetch the proposed Wasm with `stellar contract fetch --wasm-hash <hash>`.
   It must already be uploaded to be executable.
2. Diff its spec with `stellar contract info interface --wasm-hash <hash>`
   against `interface.json`.
3. If it is compatible, re-pin: update the header's upstream commit and
   hashes, vendor the new commit, and rerun the tool.
4. If it is not, before `proposed_at + 51,840`, deploy the port
   (`contracts/vendor/stellar-8004`) to testnet as our own registries, and
   replace the hook. The registry ids in `interface.json` then change, and
   the smoke agents are registered again ([#54][i54] owns re-registration).

**A testnet reset** removes trionlabs' contracts as well. The watch and the
check fail on the first run after it, with "contract not found". The
decision point is then the same: wait for upstream's new ids and re-pin, or
deploy the port ([#54][i54]).

## The local stack: the port

`contracts/vendor/stellar-8004/` holds three things:

- the three contract crates at the pin, with **no source line changed**;
- the part of OpenZeppelin `stellar-contracts` at `9dd85c30` that they use:
  `stellar-access`, `stellar-macros`, and `stellar-tokens` reduced to
  `non_fungible`;
- a workspace that pins `soroban-sdk =27.0.6` (with the
  `experimental_spec_shaking_v2` feature upstream had) and Rust 1.98.1.

The OpenZeppelin revision is kept, rather than moving to a newer one, because
it is the code that is deployed. [PORTING.md](../../contracts/vendor/stellar-8004/PORTING.md)
lists every changed line, and the build and test output. In short:

- When the port was vendored, `cargo test --workspace --locked` ran 164
  tests, and all passed: 74 upstream registry tests (identity 36, reputation
  24, validation 14) and 90 of OpenZeppelin's own tests of the vendored
  modules.
  - Those test files authorize with `mock_all_auths`, so they are not in
    the repository; PORTING.md lists them.
  - CI exercises the port with real signatures instead, through
    `square_test_support::registries`.
- `stellar contract build --locked` builds the three contracts.
- The three Wasm files were deployed twice with the constructor arguments
  below: on testnet, and on the pinned local quickstart (Protocol 27). In
  both runs, `register_with_uri`, the identity reads and the missing-id errors
  returned what the same calls return on trionlabs' deployment. The rest
  behaved as upstream's source specifies:
  - `give_feedback` as the hook calls it;
  - the validation request and response;
  - the error codes `#1`, `#4`, `#5` and `#10`;
  - `propose_upgrade`.

  Those writes were not repeated on trionlabs' registries.
- The port's spec holds **every entry of the live spec, byte for byte**. It
  adds three error enums (`NonFungibleTokenError`, `OwnableError`,
  `RoleTransferError`), because `soroban-sdk` 27's `panic_with_error!` marks
  the error type it raises for the spec and 25.3.0's did not. `--check`
  enforces this.

For [#19][i19] and [#43][i43]:

- **Build:** `stellar contract build` in that directory. It is a separate
  workspace, so nothing in `contracts/Cargo.toml` changes.
- **Deploy order and constructor arguments**, as upstream deploys:
  1. identity: `--owner <deployer> --name "Agent Registry" --symbol AGENT`.
     Those are the live `name()` and `symbol()`.
  2. reputation: `--owner <deployer> --identity_registry <identity>`.
  3. validation: `--owner <deployer> --identity_registry <identity>`.
- **The ids** go to `contracts/deployments/local.json` as the 8004 entries,
  and to the resolver's `allowedRegistries` for the local network.
- **Tests in `contracts/`** register the port's Wasm through
  `square_test_support::registries`, with clients `contractimport!` generates
  from its spec. Build the port first (`stellar contract build --locked` in
  `contracts/vendor/stellar-8004`).

## Smoke agents

The last item of [#33][i33] is two permanent registrations for [#35][i35].
Their owner keys must outlive this change, so the keys are generated and kept
by the maintainers, in the repository secrets `SMOKE_AGENT_1_SECRET` and
`SMOKE_AGENT_2_SECRET`. `contracts/vendor/stellar-8004/scripts/register-smoke-agents.mjs`
does the registration:

- **The pair is Arc's.** Agent 1 is `register_with_uri` with the smoke card as
  a compact `data:` URI. Agent 2 is a bare `register`
  ([docs/smoke/README.md](../smoke/README.md)).
- **Secrets are read from those two variables only.** The script never
  prints, logs or writes them. An owner that does not exist yet is funded by
  Friendbot.
- **Every agent is read back:** `owner_of`, `get_agent_wallet`,
  `get_metadata("agentWallet")` and `token_uri`.
- **A second run registers nothing.** It finds each owner's agents through
  `balance` and `find_owner`, and reports them.
- **It prints the JSON** that `docs/smoke/agents.json` records.

The script was run end to end on testnet on 2026-09-19. The two owners were
throwaway keys that existed only in memory for the run. **These are not the
permanent agents**; they show that the script works:

| | Agent id | Transaction | Ledger | Fee charged | of which rent |
|---|---|---|---|---|---|
| card (`register_with_uri`, 1,125-character URI) | 27 | `f4cc75eefe658f5ebfaf9221741f8ad57ea7d925937a772cd6501bc87a372e01` | 4764848 | 29,357,546 stroops = 2.9357546 XLM | 29,274,805 |
| no card (`register`) | 28 | `d5ec98aebcfdd7c59c19ae43b66ef7c44ba7cba3c2a5105d4577f3ffd6f20a0c` | 4764849 | 305,878 stroops = 0.0305878 XLM | 287,408 |

- Both agents read back as registered.
- A second run with the same keys funded nothing, registered nothing, and
  reported agents 27 and 28.
- The card's cost is almost all rent. `set_agent_uri` stores the URI in
  persistent storage and bumps its TTL to 1,036,800 ledgers (60 days), and the
  1,125 bytes are paid for up front. This is the storage cost [#35][i35] asks
  to record, in place of the EVM record's 0.017 USDC of gas.

**The permanent agents** were registered on 2026-09-19 by the same script.
Their owner keys were generated for the run by `contracts/script/testnet-keys.mjs`,
which stored them only as the repository secrets `SMOKE_AGENT_1_SECRET` and
`SMOKE_AGENT_2_SECRET` and passed them to the script through its environment.
No secret was printed or written. The script's output is
[docs/smoke/agents.stellar.json](../smoke/agents.stellar.json).

| | Agent id | Owner | Transaction | Ledger | Fee charged | of which rent |
|---|---|---|---|---|---|---|
| card (`register_with_uri`) | 29 | `GAYDVD5DURZ4TRQE7I5Y2UVUALGMPPBIVSXMEYGDSX3LSGUTPPNLCAJP` | [`2c7248b0…0464`](https://stellar.expert/explorer/testnet/tx/2c7248b0a5dd8f22e7c42ef23a43e7c07df14021a60d8877d80769df1d3b0464) | 4765322 | 1,417,348 stroops | 1,387,654 |
| no card (`register`) | 30 | `GCZTOW4ETHNC462BR2KKEDAO52OSNCOH4EE37MQRTIQJ7YPTNTWMQHBO` | [`72e2788f…8289`](https://stellar.expert/explorer/testnet/tx/72e2788fc2d51868847c1172ab985846b5469b9dfc610401623629e9dc528289) | 4765323 | 311,888 stroops | 293,418 |

**The card is Stellar's, not Arc's.** Agent 1's URI carries
[docs/smoke/agent-card.stellar.json](../smoke/agent-card.stellar.json).

- It validates against `docs/agent-card/schema.json`.
- It names no service and no capability, and says it is inactive.
- The Arc card's A2A endpoint (`smoke.invalid`) and its unserved capability
  would have written an endpoint nobody serves into a permanent record.
- When [#35][i35] has a served endpoint for the smoke agent, the owner changes
  the card with `set_agent_uri`. The identity stays the same.

## Mainnet

The later decision starts from the same code. The mainnet Wasm hashes equal
the testnet ones. It has to weigh:

- the owner being one key on mainnet too;
- 68 registered agents;
- whether upstream would move ownership to a multisig or renounce the upgrade
  path;
- whether Square can operate the watch with a paging alert rather than a
  failing CI run.

## What this does not decide

- **The `did:aip` v3 syntax**: [#32][i32].
- **The resolver's code**, including its single-ledger read: [#34][i34].
- **The hook's policy for a failed registry write**: [#13][i13] and
  [hook-failure-modes.md](hook-failure-modes.md).
- **Whether any Square contract is upgradeable**: no, per
  [#49][i49] and [upgradeability-and-governance.md](upgradeability-and-governance.md).
  This page covers only the registries Square depends on.

**Not verified here:**

- **Upstream's spec-coverage count** against the EVM reference contracts.
- **Upstream's off-chain parts** (explorer, indexer, SDK). Square uses none of
  them.
- **Mainnet behaviour beyond the reads listed above.**
