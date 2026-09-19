# Foundry to Soroban: where each contract file goes

The Soroban workspace lives in `contracts/` next to the Foundry project it
replaces ([#7](https://github.com/Square-StellarNetwork/square-stellar/issues/7)).
It contains:

- `Cargo.toml`, `rust-toolchain.toml`, `Cargo.lock`;
- `contracts/<name>/`, one crate per contract;
- `common/`, `test-support/` and `probes/`.

## When the Foundry files are removed

The Foundry files stay until the Rust contract that replaces them lands. The
reason is CI:

- These CI jobs build and deploy the Solidity contracts on anvil:
  - `build, test, gas`;
  - `@squaresdk/core against anvil`;
  - `refuse and replay`;
  - `six refusal scenarios (… anvil)`;
  - `policy → proof → release`;
  - `agent`, `mcp` and `hosted (anvil)`;
  - `local stack (make up)`;
  - the `(anvil)` package suites.
- They protect the circuit, the prover and the policy code that the Stellar
  version keeps unchanged.

A file is removed with `git rm` in the issue that replaces it. The CI job that
depends on it moves to the Rust contract in the same change. The last removal
takes `foundry.toml`, `foundry.lock`, `.gitmodules` and `lib/` with it, and
leaves `git submodule status` empty.

## The map

| Foundry | Soroban | Issue |
|---|---|---|
| `src/SquareJob.sol`, `src/interfaces/ISquareJob.sol`, `src/interfaces/IACPHook.sol`, `src/interfaces/IPayoutResolver.sol`, `src/interfaces/ISettlementHorizon.sol` | `contracts/square_job`, the hook interface types in `common` | [#9](https://github.com/Square-StellarNetwork/square-stellar/issues/9) (B2), [#8](https://github.com/Square-StellarNetwork/square-stellar/issues/8) (B1) |
| `src/Groth16Verifier.sol`, `src/interfaces/IGroth16Verifier.sol`, `script/verifier-constants.mjs`, `script/check-verifier-ic.mjs` | `contracts/groth16_verifier` and its key generator; `contracts/probes/groth16_probe` is the measured prototype | [#10](https://github.com/Square-StellarNetwork/square-stellar/issues/10) (B3) |
| `src/PolicyRegistry.sol`, `src/interfaces/IPolicyRegistry.sol`, `src/interfaces/IPolicyCommitmentPin.sol` | `contracts/policy_registry` | [#11](https://github.com/Square-StellarNetwork/square-stellar/issues/11) (B4) |
| `src/ComplianceModule.sol`, `src/interfaces/IComplianceModule.sol`, `src/interfaces/IProofState.sol` | `contracts/compliance_module` | [#12](https://github.com/Square-StellarNetwork/square-stellar/issues/12) (B5) |
| `src/SquareHook.sol`, `src/interfaces/IERC8004.sol` | `contracts/square_hook` | [#13](https://github.com/Square-StellarNetwork/square-stellar/issues/13) (B6) |
| `src/KeeperEvaluator.sol`, `src/interfaces/IKeeperEvaluator.sol` | `contracts/keeper_evaluator` | [#14](https://github.com/Square-StellarNetwork/square-stellar/issues/14) (B7) |
| `src/Arbitration.sol`, `src/interfaces/IArbitration.sol` | `contracts/arbitration` | [#15](https://github.com/Square-StellarNetwork/square-stellar/issues/15) (B8) |
| `src/ClaimMarket.sol`, `src/interfaces/IClaimMarket.sol`, `test/BuyerLists.sol` | `contracts/claim_market` | [#16](https://github.com/Square-StellarNetwork/square-stellar/issues/16) (B9) |
| `src/ScreeningRegistry.sol`, `src/interfaces/IScreeningRegistry.sol` | `contracts/screening_registry` | [#17](https://github.com/Square-StellarNetwork/square-stellar/issues/17) (B10) |
| `test/*.t.sol`, `test/invariant/*.t.sol`, `test/mocks/*.sol` | Rust tests in each crate; the hostile hooks and the 8004 registries in `test-support` | [#18](https://github.com/Square-StellarNetwork/square-stellar/issues/18) (B11) |
| `test/fixtures/proofs.json` | stays: the prover's proofs; `groth16_probe/vectors.json` carries them in Soroban bytes | — |
| `script/Deploy*.s.sol`, `script/deploy-arc-testnet.sh`, `deployments/*.json` | Soroban deploy scripts and the Stellar deployment record | [#19](https://github.com/Square-StellarNetwork/square-stellar/issues/19) (B12) |
| `script/prove-and-verify-on-arc.mjs`, `script/verify-on-arc.mjs` | `contracts/probes/scripts/groth16-testnet.mjs` is the Stellar counterpart; the CI check is [#44](https://github.com/Square-StellarNetwork/square-stellar/issues/44) (H2) | [#21](https://github.com/Square-StellarNetwork/square-stellar/issues/21) (C2), [#44](https://github.com/Square-StellarNetwork/square-stellar/issues/44) |
| `script/refusal-scenarios.mjs`, `script/refuse-and-replay-on-anvil.mjs`, `script/screening-on-anvil.mjs`, `script/screening-latency.mjs`, `script/regenerate-fixtures.mjs` | the same scenarios against the local Stellar network | [#18](https://github.com/Square-StellarNetwork/square-stellar/issues/18) (B11), [#43](https://github.com/Square-StellarNetwork/square-stellar/issues/43) (H1) |
| `packages/core/scripts/generate-abis.mjs`, `src/abi/` | `packages/core/scripts/generate-bindings.mjs`, `src/bindings/` | [#7](https://github.com/Square-StellarNetwork/square-stellar/issues/7) (done), [#23](https://github.com/Square-StellarNetwork/square-stellar/issues/23) (D1) |
| `packages/core/scripts/check-deployed-selectors.mjs` (`check:selectors`) | `check:deployed-wasm`: `stellar contract fetch` and a sha256 comparison against the deployment record | [#19](https://github.com/Square-StellarNetwork/square-stellar/issues/19) (B12) |
| `foundry.toml`, `foundry.lock`, `.gitmodules`, `lib/forge-std`, `lib/openzeppelin-contracts`, the `Makefile` submodule target | removed with the last file above | the last B-cluster issue to land |

## OpenZeppelin on Soroban

The published OpenZeppelin `stellar-contracts` crates (0.7.2) require
`soroban-sdk ^26.1.0`, and this workspace pins `=27.0.6`
([stellar-target.md](../decisions/stellar-target.md)).

- Cargo resolves both SDK versions side by side, so the dependency alone
  compiles.
- Passing one of this workspace's `Env` or `Address` values to an OpenZeppelin
  function fails with `E0308`: the types come from different crates.
- `lib/openzeppelin-contracts` therefore has no Soroban counterpart here.
  [upgradeability-and-governance.md](../decisions/upgradeability-and-governance.md)
  records the ownership decision.
