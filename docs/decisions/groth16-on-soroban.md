# Groth16 on Soroban: BN254 host functions, the circuit unchanged

**Status:** decided in [#2][i2]. Binds the verifier contract in [#10][i10], the
compliance module in [#12][i12], the prover's Soroban encoding in [#21][i21] and
the policy package in [#22][i22]. The measurements below are from 2026-09-19.

[i2]: https://github.com/Square-StellarNetwork/square-stellar/issues/2
[i10]: https://github.com/Square-StellarNetwork/square-stellar/issues/10
[i12]: https://github.com/Square-StellarNetwork/square-stellar/issues/12
[i21]: https://github.com/Square-StellarNetwork/square-stellar/issues/21
[i22]: https://github.com/Square-StellarNetwork/square-stellar/issues/22
[i44]: https://github.com/Square-StellarNetwork/square-stellar/issues/44
[i51]: https://github.com/Square-StellarNetwork/square-stellar/issues/51

## The decision

1. **The curve stays BN254.** None of these change:
   - `circuits/payment.circom`;
   - the adopted phase-1 powers of tau (Perpetual Powers of Tau, contribution 80);
   - the Poseidon commitment (`Poseidon(3)` leaves, `Poseidon(8)` root);
   - the prover.

   Only the verifier is written again, in Rust, on Soroban's BN254 host
   functions.
2. **The verifier is a Soroban contract, `groth16_verifier` ([#10][i10]).** It
   computes:
   - `vk_x = IC_0 + Σ signal_i · IC_i` with `g1_msm`;
   - then `pairing_check([-A, vk_x, C, alpha], [B, gamma, delta, beta])`.

   This is the same equation `contracts/src/Groth16Verifier.sol` evaluates on
   the EVM precompiles. `-A` is `(X, p - Y)`: the SDK's `Neg` for
   `Bn254G1Affine` does exactly that.
3. **The proof is 512 bytes:** `A (64) ‖ B (128) ‖ C (64) ‖ 8 × signal (32,
   big-endian)`. That is the same length as the sixteen words the EVM kernel
   stores. `MAX_COMPLIANCE_PROOF = 1024` stays.
4. **Every signal is checked to be `< r` before it becomes a scalar.**
   - `Bn254Fr::from(U256)` reduces modulo r
     (`soroban-sdk-27.0.6/src/crypto/bn254.rs`, `impl From<U256> for Bn254Fr`).
   - Without the check, a signal `s` and `s + r` both verify. The vector
     `compliant_with_signal_plus_r` shows it.
   - The EVM verifier's `input[i] >= SCALAR_FIELD → false` is kept as it is.
   - `policy_registry`'s commitment range check uses the same constant.
5. **The G2 byte order is settled: imaginary part first.** The rule is below,
   and a test vector enforces it.

## What was verified, and where

### The host functions exist on both networks

| Function | CAP | Protocol | Status |
|---|---|---|---|
| `bn254_g1_add`, `bn254_g1_mul`, `bn254_multi_pairing_check` | [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md) | 25 | Final |
| `bn254_g1_msm`, `bn254_fr_add/sub/mul/pow/inv`, `bn254_g1_is_on_curve` | [CAP-0080](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0080.md) | 26 | Implemented |
| `poseidon_permutation`, `poseidon2_permutation` over BLS12-381 or BN254 Fr | [CAP-0075](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0075.md) | 25 | Final |

Both public networks run Protocol 28
([stellar-target.md](stellar-target.md)), so all three are live. The pinned
`soroban-sdk 27.0.6` exposes them as `env.crypto().bn254()`: `g1_add`,
`g1_mul`, `g1_msm`, `pairing_check`, `g1_is_on_curve` and `fr_*`. Its scalar
type is `Bn254Fr`; the older alias `Fr` is deprecated in 27.x.

On-chain Poseidon is possible but not needed. `policy_registry` compares a
32-byte commitment with a 32-byte commitment, exactly as `PolicyRegistry.sol`
does, and nothing on chain recomputes a Poseidon hash.

### Encoding rules

These come from [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md),
section "Field and groups":

| | Bytes | Layout |
|---|---|---|
| `fp` | 32 | big-endian, `< p` |
| `fp2` | 64 | `be(c1) ‖ be(c0)` — **imaginary part first** |
| G1 | 64 | `be(X) ‖ be(Y)`; infinity is `(0, 0)`; no flag bits |
| G2 | 128 | `be(X.c1) ‖ be(X.c0) ‖ be(Y.c1) ‖ be(Y.c0)`; infinity is `(0, 0)` |
| scalar | `U256` | any value; the host reduces it modulo r |

This is EIP-197's order. The Solidity verifier already stores its key that
way (`BETA_X_IM`, `BETA_X_RE`, …), and the prover already emits `pi_b` that way
for Solidity (`services/prover/src/convert.js`, `encodeB`).

The conversion rule, implemented in `contracts/probes/scripts/encode.mjs`:

| From | G1 | G2 |
|---|---|---|
| snarkjs (`vk.json`, `proof.json`): `[x, y, "1"]` and `[[x.c0, x.c1], [y.c0, y.c1], ["1", "0"]]` | `be(x) ‖ be(y)` | `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` — **swap each pair** |
| Solidity calldata: `[x, y]` and `[[x.c1, x.c0], [y.c1, y.c0]]` | `be(x) ‖ be(y)` | the four words in the order given — **no swap** |

Each coordinate must be `< p`, and the encoder refuses one that is not.
Signals are carried unreduced, so the verifier is the one that refuses
`s ≥ r`. `A` is sent as the prover made it, and the verifier negates it.

The key blob the probe takes is `alpha ‖ beta ‖ gamma ‖ delta ‖ IC_0..IC_8`,
1024 bytes. `groth16_verifier` embeds the same values as constants instead
([#10][i10] writes its generator).

### The test vector

`contracts/probes/groth16_probe/vectors.json` is written by
`contracts/probes/scripts/vectors.mjs`, and `--check` fails if the file is
stale. It carries 14 cases from three sources:

- **`fixtures`:** the prover's proofs in `contracts/test/fixtures/proofs.json`,
  with the key constants of `contracts/src/Groth16Verifier.sol` (zkey sha256
  `e41a9a13…dc480`). These are in Solidity calldata shape.
- **`snarkjs`:** `groth16_probe/snarkjs/{vk,proof,public}.json`, snarkjs' own
  output for a key built by `circuits/scripts/build.mjs` (zkey sha256
  `4b647022…2280e`), written by `circuits/scripts/probe-vectors.mjs`. This is
  the shape the prover receives from snarkjs.
- **`stellar_addresses`:** proofs from that same key and the unchanged circuit,
  with `recipient` and `token` set to the field mapping of real Stellar
  addresses (`contracts/probes/address_field_probe/circuit/*.json`,
  [address-field-mapping.md](address-field-mapping.md)).

Both keys are single-contribution **development keys**. Their phase 2 is not a
ceremony ([docs/disclosure/zk-setup-status.md](../disclosure/zk-setup-status.md),
[#51][i51]).

| Case | Expected | Local host (`cargo test`) | Testnet (`simulateTransaction`) |
|---|---|---|---|
| fixtures `compliant` | valid | valid | valid |
| fixtures `blocked` (`is_compliant = 0`) | valid | valid | valid |
| fixtures `compliant_with_receipt` | valid | valid | valid |
| fixtures `compliant_rerandomised` | valid | valid | valid |
| fixtures `blocked_with_is_compliant_flipped` | invalid | invalid | invalid |
| fixtures `compliant_with_amount_changed` (+1 base unit) | invalid | invalid | invalid |
| fixtures `compliant_with_signal_plus_r` | invalid | invalid | invalid |
| fixtures `compliant_with_b_in_snarkjs_order` (c0 first) | error | error | `Error(Crypto, InvalidInput)` |
| snarkjs `compliant` | valid | valid | valid |
| snarkjs `compliant_with_is_compliant_flipped` | invalid | invalid | invalid |
| snarkjs `compliant_with_amount_changed` | invalid | invalid | invalid |
| stellar_addresses `compliant_to_a_g_account` | valid | valid | valid |
| stellar_addresses `blocked_g_account` (`is_compliant = 0`) | valid | valid | valid |
| stellar_addresses `compliant_with_recipient_swapped` | invalid | invalid | invalid |

What the rows show:

- **The G2 rule is not a convention that happens to work.** Writing `B` in
  snarkjs' own order makes the host refuse the point outright.
- **The snarkjs rows prove the swap.** They come from raw snarkjs output
  through the swap and verify.
- **A proof that says "not compliant" is still a valid proof.**
  `blocked` verifies: the circuit proves the six rules ran, and reading
  signal 0 and refusing is the compliance module's job ([#12][i12]), as it is
  on EVM.

The probe (`contracts/probes/groth16_probe`) was deployed to testnet at
`CAQVJ4EXS2BTU25BD2UEVZ6RWZYCEZXLFLHR57ESP66F5M4KF5ITTULE`
(Wasm sha256 `1a5bbbeb…17ec1`). The steps were:

- upload tx `c4096bb8…c3d4`;
- create tx `ce6a23f9…f6d4`;
- one real `verify(compliant) → true`, tx `9427354a…bd31`, ledger 4759823.

It is the Stellar counterpart of the removed "verifies on Arc Testnet" check.
[#44][i44] decides whether CI runs `groth16-testnet.mjs` against a deployed
probe or deploys its own.

### Cost

Measured on testnet, and on the local host with the same host code:

| | Value |
|---|---|
| CPU instructions, one verification (testnet simulation) | 29,991,050 |
| — of which pairing (4 pairs), local host | 17,528,691 |
| — G2 subgroup checks (4 points), local host | 6,824,208 |
| — `g1_msm` (8 terms), local host | 3,783,198 |
| Memory (local host) | 300,613 bytes |
| Ledger reads | 2 entries (contract instance and code), 0 disk bytes |
| `minResourceFee` (simulation) | 40,108 stroops = 0.0040108 XLM |
| Fee charged for the real call (`getTransaction`) | 30,591 stroops = 0.0030591 XLM: 30,451 non-refundable + 40 refundable + 100 inclusion |
| Testnet `txMaxInstructions` | 400,000,000 — one verification uses 7.5% |
| Testnet `feeRatePerInstructionsIncrement` | 7 stroops per 10,000 instructions |

The limits and rates are read from testnet's own `CONFIG_SETTING` ledger
entries. The transaction declared the simulated resource fee (40,108). The
network charged what was used and returned the unused refundable allowance.

A refused signal (`≥ r`) returns before any curve arithmetic: 496,462
instructions. This is the first row of the resource-fee table that replaces
`docs/deploy/gas.md` ([fees-and-ttl.md](fees-and-ttl.md)).

## Differences from the EVM verifier that the contracts must keep

- **An undecodable point traps; it does not return `false`.**
  - On EVM, a failed precompile call made `verifyProof` return `false`.
  - On Soroban, a point off the curve or not in the subgroup, a coordinate
    `≥ p`, or flag bits set make the host fail the call.
  - The compliance module calls the verifier through `try_invoke_contract`
    ([call-graph-on-soroban.md](call-graph-on-soroban.md)), so a trap
    becomes a refused proof and not a failed release.
- **Negating `A` needs `A.Y < p`.** The SDK's `Neg` panics on a larger
  value, which falls under the previous point.
- **No gas stipend.** A verification is bounded by the transaction's
  instruction budget, not a per-call gas limit. At 30M of 400M it leaves room
  for the rest of a `complete`.

## Alternatives, and why each was rejected

| Alternative | Why not |
|---|---|
| **Move the circuit to BLS12-381.** Soroban has BLS12-381 host functions too (CAP-0059). | circomlib's Poseidon constants are specific to the BN254 scalar field, so the commitment would change. The adopted phase-1 file (PPoT contribution 80) is BN254, so a new phase 1 would be needed. `docs/ceremony/*` is written for BN254, and the ceremony ([#51][i51]) would restart from scratch. It gains nothing: the BN254 host functions are live. |
| **Pairing in Wasm** (a Rust pairing library compiled into the contract) | Pays metered Wasm execution for what the host does natively under the `Bn254Pairing` cost type. It ships a large crypto library inside a contract that must stay auditable. It is only needed where no host function exists, and here one does. |
| **A zkVM verifier** (e.g. RISC Zero's Groth16 wrapper, or a Noir/UltraHonk verifier) | Both mean replacing the circom circuit, its tests (`circuits/test/*`), the prover and the ceremony plan. The problem is verifying *this* circuit's proofs, and the host does that directly. |
| **A third-party Soroban Groth16 verifier** as a dependency | Examples can be read for reference, but the verifier is written here from the pairing equation under Apache-2.0, as the EVM one was ([groth16-verifier-license.md](groth16-verifier-license.md)). The probe's `verify` is under a hundred lines of arithmetic on host functions, and a dependency would be a second audit surface for no saving. |
