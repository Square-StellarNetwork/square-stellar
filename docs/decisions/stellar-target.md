# Stellar target: network, protocol, toolchain and USDC

**Status:** decided in [#1][i1]. This is the single source for the constants the
Stellar port builds on. The version pins are applied to `rust-toolchain.toml`,
`Cargo.toml` and `package.json` by [#7][i7]. The network profile below is
implemented in `@squaresdk/core` by [#23][i23]. The README network table is
finalised in [#46][i46].

[i1]: https://github.com/Square-StellarNetwork/square-stellar/issues/1
[i7]: https://github.com/Square-StellarNetwork/square-stellar/issues/7
[i23]: https://github.com/Square-StellarNetwork/square-stellar/issues/23
[i46]: https://github.com/Square-StellarNetwork/square-stellar/issues/46

Every value on this page was checked on 2026-09-19 against the source linked
next to it. Where the source is a command, the command and its output are
quoted.

## The decision

- **Network:** Stellar **testnet** first. Pubnet constants are recorded so
  that nothing has to be rediscovered later, but nothing targets pubnet yet.
- **Protocol:** **27**. The SDKs, the CLI and the local network image are
  pinned to the Protocol 27 release line.
- **Payment token:** USDC issued natively by Circle, used through its Stellar
  Asset Contract (SAC). The SAC reports **7 decimals**. Every place that
  assumes 6 decimals changes; the inventory is at the end of this page.
- **Fees:** XLM.

## Pinned versions

| Component | Pin | Source |
|---|---|---|
| Rust toolchain | `1.98.1`, target `wasm32v1-none` | [Rust stable channel](https://static.rust-lang.org/dist/channel-rust-stable.toml) (`1.98.1`, 2026-09-01) |
| `soroban-sdk` (Rust) | `=27.0.6` | [crates.io](https://crates.io/crates/soroban-sdk/27.0.6), [Software Versions](https://developers.stellar.org/docs/networks/software-versions) |
| `stellar-cli` | `27.1.0` | [release v27.1.0](https://github.com/stellar/stellar-cli/releases/tag/v27.1.0), [Software Versions](https://developers.stellar.org/docs/networks/software-versions) |
| `@stellar/stellar-sdk` (JS) | `16.3.0` | [npm](https://www.npmjs.com/package/@stellar/stellar-sdk/v/16.3.0) (`lts-16` dist-tag), [release notes](https://github.com/stellar/js-stellar-sdk/releases/tag/v16.3.0) |
| `stellar/quickstart` image | `stellar/quickstart:v649-b1276.1-testing@sha256:0ff11d404c423563a522c573ef693244d4c29b0dbc2f65b49c475761c0e670da` | [Docker Hub](https://hub.docker.com/r/stellar/quickstart/tags?name=v649-b1276.1-testing); built from [`73e457d`](https://github.com/stellar/quickstart/blob/73e457d8cd5f8cf9e3511d55231c85a30fd3e80c/images.json) |

Why each pin is the value it is:

- **Rust `1.98.1`.** The official setup page asks for Rust
  [1.84.0 or newer][setup] with the `wasm32v1-none` target.
  `soroban-sdk 27.0.6` declares `rust-version = "1.91.0"`. `stellar-cli 27.1.0`
  declares `1.93.0`. Both upstream repositories pin only `channel = "stable"`,
  which is not reproducible, so we pin the current stable release by number.
- **`soroban-sdk =27.0.6`.** This is the latest 27.x release. `28.0.0` was
  published on 2026-09-18 and belongs to Protocol 28.
- **`stellar-cli 27.1.0`.** This is the latest 27.x release. `28.0.0` exists
  (2026-08-26) and belongs to Protocol 28.
- **`@stellar/stellar-sdk 16.3.0`, not `16.2.0`.** The Software Versions page
  still lists `16.2.0` for Protocol 27. `16.3.0` is the newer release on the
  same 16.x line, and it adds the Protocol 28 XDR types: CAP-83's
  `STELLAR_VALUE_EMPTY_TX_SET` and CAP-85's external executable references.
  Both public networks already run Protocol 28 (see the next section). A
  Protocol 27 client that reads ledgers and contract entries from those
  networks therefore has to decode these types, and `16.2.0` cannot.
- **Quickstart `v649-b1276.1-testing`.** Its `images.json` sets
  `protocol_version_default: 27` and ships stellar-core `v27.1.0`, stellar-rpc
  `v27.1.1` and Horizon `v27.0.0`. Two things rule out later images:
  - From `v655` (2026-08-18) the image ships stellar-core `v28.0.0` and
    stellar-rpc `v28.0.0` instead of the Protocol 27 releases, even though it
    still starts the network at protocol 27.
  - From `v659` (2026-08-25,
    [stellar/quickstart#975](https://github.com/stellar/quickstart/pull/975))
    the default protocol is 28.

  The image is pinned by index digest and covers `amd64` and `arm64`.

[setup]: https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup

The set was checked by building and testing a probe contract with Rust
`1.98.1`, `soroban-sdk =27.0.6` and `stellar-cli 27.1.0`. The probe calls the
CAP-0074 BN254 `g1_add` host function:

```console
$ stellar --version
stellar 27.1.0 (8e402ea28202950b272fbabc34caad4d2f64fe87)
$ stellar contract build
    Wasm Hash: ffbe56683a81e019e57720dbfc948901238d8e61a63f1030fc444d1f76b4b5a8
    Wasm Size: 442 bytes optimized (original size was 471 bytes)
✅ Build Complete
$ cargo test
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

The `stellar-cli` binary came from the release's
`aarch64-apple-darwin` tarball (sha256
`265420fee0d4fb309603bfa5412c151280685f52879ca0e075f5a5e508d19e82`). Its build
provenance passed `gh attestation verify -R stellar/stellar-cli`.

## Protocol 28: the switch condition, and its state today

This decision locks Protocol 27. The switch to 28 is triggered when **testnet
runs Protocol 28**. The switch is then a separate change that moves every pin
at once:

- `soroban-sdk` to `28.x`
- `stellar-cli` to `28.x`
- `@stellar/stellar-sdk` to `17.x`
- the quickstart image to a build whose default protocol is 28

**That condition is already met.** The live networks on 2026-09-19:

```console
$ curl -s -X POST https://soroban-testnet.stellar.org -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}'
{"jsonrpc":"2.0","id":1,"result":{"friendbotUrl":"https://friendbot.stellar.org/","passphrase":"Test SDF Network ; September 2015","protocolVersion":28}}

$ curl -s https://horizon.stellar.org | jq '{core_version, current_protocol_version, network_passphrase}'
{
  "core_version": "stellar-core 28.0.1 (947aad8413c189d85504acf72207e85eeda9b021)",
  "current_protocol_version": 28,
  "network_passphrase": "Public Global Stellar Network ; September 2015"
}
```

The dates of both upgrades:

| Protocol | Testnet | Pubnet | Source |
|---|---|---|---|
| 27 "Zipper" | 2026-06-18 | vote 2026-07-08 | [upgrade guide](https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide) |
| 28 "Adapter" | vote 2026-08-27 | vote 2026-09-16 | [upgrade guide](https://stellar.org/blog/developers/adapter-protocol-28-upgrade-guide) |

Protocol 28 contains three CAPs:

- **CAP-83:** an empty transaction set consensus value.
- **CAP-85:** externally managed contract executables.
- **CAP-86:** sparse map host functions.

None of them removes or changes the BN254 (CAP-0074, CAP-0080) or Poseidon
(CAP-0075) host functions this port depends on.

The [Software Versions](https://developers.stellar.org/docs/networks/software-versions)
page still shows Protocol 28 as "TBD". The live network responses above are
the source for the protocol state.

## Networks

| | Testnet | Pubnet | Local (quickstart `--local`) |
|---|---|---|---|
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` | `Standalone Network ; February 2017` |
| CAIP-2 | `stellar:testnet` | `stellar:pubnet` | none |
| RPC | `https://soroban-testnet.stellar.org` | no SDF endpoint; [RPC providers](https://developers.stellar.org/docs/data/apis/rpc/providers) | `http://localhost:8000/rpc` |
| Horizon | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` | `http://localhost:8000` |
| Friendbot | `https://friendbot.stellar.org` | none | `http://localhost:8000/friendbot` |
| Explorer | `https://stellar.expert/explorer/testnet` | `https://stellar.expert/explorer/public` | none |

Sources for the table:

- **Testnet and pubnet passphrases:** the live `getNetwork` and Horizon root
  responses above, and the [Networks](https://developers.stellar.org/docs/networks)
  page.
- **Testnet Friendbot:** `friendbotUrl` in the testnet `getNetwork` response.
- **CAIP-2:** the [Stellar CAIP-2 namespace](https://namespaces.chainagnostic.org/stellar/caip2).
  `@x402/stellar` uses the same strings.
- **Local column:** quickstart's
  [`start`](https://github.com/stellar/quickstart/blob/73e457d8cd5f8cf9e3511d55231c85a30fd3e80c/start)
  script and
  [README](https://github.com/stellar/quickstart/blob/73e457d8cd5f8cf9e3511d55231c85a30fd3e80c/README.md)
  at the pinned image's commit.
- **Explorer:** the URLs were checked by loading them.

## USDC

| | Testnet | Pubnet |
|---|---|---|
| Asset | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| Stellar Asset Contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Decimals | 7 (read on chain) | 7 (read on chain) |

- **Issuers:** from Circle's
  [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
  page. Circle publishes only the issuer accounts, not the contract IDs.
- **Contract IDs:** derived with the pinned CLI.

  ```console
  $ stellar contract id asset --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet
  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
  $ stellar contract id asset --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN --network mainnet
  CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
  ```

  Two independent checks give the same IDs:
  - They equal `USDC_TESTNET_ADDRESS` and `USDC_PUBNET_ADDRESS` exported by
    [`@x402/stellar@2.26.0`](https://www.npmjs.com/package/@x402/stellar/v/2.26.0).
  - They equal `new Asset("USDC", issuer).contractId(passphrase)` from
    `@stellar/stellar-sdk@16.3.0`.
- **Decimals:** read from the deployed contracts by simulating `decimals()`,
  `name()` and `symbol()`. Both return `decimals() = 7` and `symbol() = USDC`.
  - Testnet: run against `https://soroban-testnet.stellar.org`. `name()`
    returned `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
    The contract is also indexed on
    [stellar.expert](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA).
  - Pubnet: run against two public providers from the
    [RPC providers](https://developers.stellar.org/docs/data/apis/rpc/providers)
    list, `https://mainnet.sorobanrpc.com` and
    `https://rpc.lightsail.network/`. `name()` returned
    `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.

The circuit keeps its 64-bit bound on `amount` and `daily_spent_before`
([erc20-vs-native-usdc.md](erc20-vs-native-usdc.md)). At 7 decimals,
2^64 base units are about 1.84 trillion USDC. That is still far beyond any
plausible mandate, so the move from 6 to 7 decimals does not widen the
circuit.

## Network profile

`@squaresdk/core` today carries an EVM `NetworkProfile` keyed by chain id:
`chainId`, `name`, `rpcUrl`, `explorerUrl` and `nativeCurrency`, all in
`packages/core/src/deployments.ts`. The Stellar counterpart replaces the chain
id with the network passphrase and carries everything above:

```ts
export interface StellarNetworkProfile {
  /** Network passphrase; the identity of the network. */
  networkPassphrase: string;
  /** CAIP-2 id (`stellar:testnet`, `stellar:pubnet`); undefined on a local network. */
  caip2: `stellar:${string}` | undefined;
  name: string;
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl: string | undefined;
  explorerUrl: string | undefined;
  usdc: { issuer: string; contractId: string; decimals: 7 };
}
```

This page decides the fields and their values. [#23][i23] implements the type,
the testnet and local entries, and the lookup by passphrase. The local
network's USDC is deployed by the local stack, so its `usdc` value comes from
the local deployment record, not from a constant.

## 6-decimal inventory

These are the places that assume USDC has 6 decimals. Each one is fixed by the
issue that owns the file. This issue only lists them.

Two searches produced the list:

- **Prose.** The command from #1, run over tracked files:
  `git grep -n "6 decimals\|6-decimal\|6 ondalık"`.
- **Code.** A second pass for `parseUnits(…, 6)`, `formatUnits(…, 6)`,
  `USDC_DECIMALS`, `1_000_000` and `1e6` used as a USDC unit (including the
  bond and reputation-budget defaults), and the `1e12` native-to-ERC-20
  divisor.

| Owner | Files and lines |
|---|---|
| [#8][i8] B1 (storage and event schema) | `docs/design/storage-and-events.md:29,52,63` |
| [#11][i11] B4 (`policy_registry`) | `contracts/src/interfaces/IPolicyRegistry.sol:40` |
| [#20][i20] C1 (circuit) | `circuits/payment.circom:47,56,57`; `circuits/README.md:33,63`; `circuits/test/helpers/inputs.mjs:87` |
| [#21][i21] C2 (prover) | `services/prover/src/openapi.js:308,312,327,334`; `services/prover/src/prover.js:385`; `services/prover/README.md:189`; `services/prover/test/validation.test.js:493` |
| [#22][i22] C3 (`@squaresdk/policy`) | `packages/policy/src/duty.ts:458`; tests in `packages/policy/test/` (`anvil`, `release`, `state`). `packages/policy/README.md`, which #1 names, has no decimal assumption: its only "decimal" is a salt written in base 10. |
| [#23][i23] D1 (`@squaresdk/core`) | `packages/core/scripts/lifecycle.ts:273,284,416,471,545,566,598` (`598` is the `1e12` divisor); `packages/core/test/anvil.test.ts`, `fork.test.ts` |
| [#24][i24] D2 (`@squaresdk/data`) | `docs/design/data-layer.md:93,317`; `packages/data/test/x402Payments.test.ts:14,30` |
| [#26][i26] D4 (`@squaresdk/x402`) | `packages/x402/src/network.ts:15,38` (`USDC_DECIMALS = 6`); `packages/x402/src/client.ts:36`; `packages/x402/README.md:13` |
| [#27][i27] D5 (`@squaresdk/aa`) | `packages/aa/src/constants.ts:25` (`NATIVE_USDC_DECIMALS = 18`); `packages/aa/scripts/fork.ts:240,256,257,258`, `measure.ts:140`, `measure-live.ts:59`; `packages/aa/test/selfBundler.test.ts:61` |
| [#29][i29] D7 (agent, mcp, hosted) | `packages/agent/src/agent.ts:125`; `packages/mcp/src/hire.ts:136,138,140,144`; `packages/mcp/src/server.ts:203,319,324,392,393,423,424,445,480,555`; `packages/hosted/src/host.ts:138`, `allowance.ts:116`, `delegation.ts:131`; tests in `packages/{agent,mcp,hosted}/test/` |
| [#30][i30] D8 (`@squaresdk/cli`) | `packages/cli/src/commands/policy.ts:77,231,232,314,315,446,533,572,573`; `packages/cli/test/policy.anvil.test.ts` |
| [#31][i31] D9 (CCTP) | `packages/core/src/cctp/index.ts:317`; `packages/core/scripts/bridge.ts:104,122,134,140,144,159,162`; `docs/design/cctp-funding.md:82`; `packages/core/test/cctp.fork.test.ts:36` |
| [#36][i36] F1 (indexer) | `services/indexer/test/anvil.test.ts`, `sync.test.ts`, `reducer.test.ts` |
| [#37][i37] F2 (keeper) | `services/keeper/src/decide.ts:4` (`NATIVE_TO_USDC_DIVISOR = 1e12`); `services/keeper/src/run.ts:114`; `services/keeper/test/decide.test.ts:35`; `services/keeper/scripts/measure-gated-gas.mjs:34,39`; other tests in `services/keeper/test/` |
| [#39][i39] G1 (app) | `app/src/lib/format.ts:3` (`USDC_UNIT = 1_000_000n`) and its fraction handling; `app/src/lib/charts.ts:50`; `app/README.md:80`; tests in `app/src/lib/*.test.ts` |
| [#41][i41] G3 (site) | `site/src/components/site/standards.tsx:5` |
| [#19][i19] B12 (deploy scripts) | `contracts/script/DeployLocal.s.sol:129,142,201,202`; `contracts/script/DeploySettlement.s.sol:79,81` (`MIN_BOND`, `MIN_REPUTATION_BUDGET` defaults); `contracts/script/deploy-arc-testnet.sh:18,20`; `contracts/script/refusal-scenarios.mjs:76,104,105`; `contracts/script/refuse-and-replay-on-anvil.mjs:78,140,289`; `contracts/script/screening-latency.mjs:141`; `contracts/script/screening-on-anvil.mjs:163` |
| [#18][i18] B11 (contract tests) | The Foundry suite in `contracts/test/` (`Base.t.sol`, `ComplianceModule.t.sol`, `PolicyRegistry.t.sol`, `SquareJob.t.sol`, `invariant/*.t.sol`) uses 6-decimal amounts throughout; B11 replaces it with the Rust suite |
| [#46][i46] H4 (documentation) | `docs/decisions/erc20-vs-native-usdc.md:14,85,107` (superseded note); `README.md` already says 7 decimals |

[i8]: https://github.com/Square-StellarNetwork/square-stellar/issues/8
[i11]: https://github.com/Square-StellarNetwork/square-stellar/issues/11
[i18]: https://github.com/Square-StellarNetwork/square-stellar/issues/18
[i19]: https://github.com/Square-StellarNetwork/square-stellar/issues/19
[i20]: https://github.com/Square-StellarNetwork/square-stellar/issues/20
[i21]: https://github.com/Square-StellarNetwork/square-stellar/issues/21
[i22]: https://github.com/Square-StellarNetwork/square-stellar/issues/22
[i24]: https://github.com/Square-StellarNetwork/square-stellar/issues/24
[i26]: https://github.com/Square-StellarNetwork/square-stellar/issues/26
[i27]: https://github.com/Square-StellarNetwork/square-stellar/issues/27
[i29]: https://github.com/Square-StellarNetwork/square-stellar/issues/29
[i30]: https://github.com/Square-StellarNetwork/square-stellar/issues/30
[i31]: https://github.com/Square-StellarNetwork/square-stellar/issues/31
[i36]: https://github.com/Square-StellarNetwork/square-stellar/issues/36
[i37]: https://github.com/Square-StellarNetwork/square-stellar/issues/37
[i39]: https://github.com/Square-StellarNetwork/square-stellar/issues/39
[i41]: https://github.com/Square-StellarNetwork/square-stellar/issues/41

Several `1_000_000` values are not USDC units, and they are left out of the
table:

- the hook gas limit in `contracts/script/refusal-scenarios.mjs:75`,
  `contracts/script/DeployLocal.s.sol:127` and
  `packages/aa/scripts/fork.ts:238`
- the gas figure in `services/keeper/test/gas.test.ts:55`
- the millions suffix in `app/src/lib/charts.ts:276`
