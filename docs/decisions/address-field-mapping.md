# 32-byte Stellar addresses in the circuit: one field element through sha256

**Status:** decided in [#4][i4]. Binds the circuit's signal meaning in
[#20][i20], the prover's encoding in [#21][i21], the policy package in
[#22][i22] and the compliance module's binding in [#12][i12].

[i4]: https://github.com/Square-StellarNetwork/square-stellar/issues/4
[i12]: https://github.com/Square-StellarNetwork/square-stellar/issues/12
[i20]: https://github.com/Square-StellarNetwork/square-stellar/issues/20
[i21]: https://github.com/Square-StellarNetwork/square-stellar/issues/21
[i22]: https://github.com/Square-StellarNetwork/square-stellar/issues/22
[i51]: https://github.com/Square-StellarNetwork/square-stellar/issues/51

## The problem

The circuit carries addresses as one BN254 field element each:

- the public signals `recipient` and `token`;
- the private list entries `token_whitelist[]` and `blocked_addresses[]`;
- `operator_id_field`, which enters the policy commitment.

An EVM address is 20 bytes and fits. A Stellar address does not:

- An account (`G…`) is a 32-byte ed25519 public key.
- A contract (`C…`) is a 32-byte hash.
- BN254's scalar field has r ≈ 2^253.6, so about 80% of random 32-byte values
  lie outside it.

The Solana version of this circuit had the same problem and split each
address into `high`/`low` halves, which made ten public signals.

## Options

| | Option | Signals | On-chain cost | Verdict |
|---|---|---|---|---|
| 1 | `high`/`low` 128-bit halves, as the Solana version did | 10 | two more MSM terms, a circuit change and a new key | Lossless, but undoes the collapse `circuits/README.md` describes and changes the constraint system. |
| 2 | **Hash to a field element:** `f(addr) = sha256(XDR(addr))[0..31]` | 8 | one `sha256` host call per address | **Chosen.** |
| 3 | Reduce the raw 32 bytes modulo r | 8 | U256 arithmetic | Rejected. Two addresses can land on the same element, and justifying why that cannot be arranged is harder than choosing option 2. |

## The decision: f

```
f(addr) = int_be( sha256( XDR(ScVal::Address(addr)) )[0..31] )
signal  = 0x00 || sha256( XDR(ScVal::Address(addr)) )[0..31]     (32 bytes, big-endian)
```

- **The input bytes are the XDR of the address as an `ScVal`**, not the
  strkey text and not the bare `ScAddress`.
  - A contract gets these bytes from `Address::to_xdr(&env)`.
  - TypeScript gets them from `Address.fromString(s).toScVal().toXDR()`.
  - Using XDR instead of the strkey avoids case and checksum questions, and
    the `G`/`C` distinction is inside the bytes.
- **#4 named `Address.toScAddress().toXDR()` for TypeScript, and that would
  have been a bug.** That is the bare `ScAddress`. `to_xdr` in a contract
  serializes the `ScVal`, which is the same bytes preceded by the 4-byte tag
  `0x00000012` (`SCV_ADDRESS`). For the testnet USDC issuer the two are 44 and
  40 bytes long, so `f` would disagree between the prover and the contract.
  The vectors below record the `ScVal` bytes so the difference cannot come
  back.
- **Truncating to 31 bytes gives 248 bits.** That is always `< r`, so there
  is never a reduction, and no two encodings of one address exist.
- **Collisions.** Two distinct addresses collide with probability about 2^-248
  for a random pair. Finding any colliding pair (birthday bound) takes about
  2^124 hashes.
- **`f` is defined on addresses only.** Muxed accounts (`M…`) are not
  addresses a contract stores or pays, and are out of scope.

### Where f is computed

| Place | What it maps | Issue |
|---|---|---|
| `compliance_module` | `f(payee)` and `f(token)`, compared byte for byte with signals 2 and 4 | [#12][i12] |
| prover (`services/prover`) | `recipient_in`, `token_in`, and every `token_whitelist` / `blocked_addresses` entry the caller sends as a Stellar address | [#21][i21] |
| `@squaresdk/policy` | the same list entries and `operator_id_field`, before the commitment | [#22][i22] |
| `policy_registry` | nothing: the commitment is a Poseidon output and is compared as 32 bytes | — |

The two reference implementations are:

- `contracts/probes/scripts/address-field.mjs`, in JavaScript. The prover and
  the policy package are JavaScript and take it as it is.
- `contracts/probes/address_field_probe`, a contract.

`vectors.json` is written by the first and checked by the second:
`cargo test -p address_field_probe` asserts both the XDR bytes and `f` for
every vector.

### Test vectors

Real addresses: the USDC issuers and their Stellar Asset Contracts
([stellar-target.md](stellar-target.md)).

| Name | Address | Signal (hex) |
|---|---|---|
| `usdc_issuer_testnet` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `0038622f1b6bed4428f007d87a0699c11bd471da6079d3bd54389565e67ca04c` |
| `usdc_sac_testnet` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `00f3f621aaa28a2f21130f183b450020ee2016bb79edd9fdaf15bf5ecba4f002` |
| `usdc_issuer_pubnet` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | `0057eb773202bd4b5e3528a821ff15a929aa379bf9b7e2943818c97ba7416e9a` |
| `usdc_sac_pubnet` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` | `006dab8a377286236a25f018858be3b5d64045f87af64269d10dac584f6cf5ef` |

`contracts/probes/address_field_probe/vectors.json` also carries each
address's `ScVal` XDR and the decimal form the circuit input takes.

## The circuit does not change, and neither does its key

#4 expected a circuit change and a new phase 2. Measuring it showed neither is
needed:

- **No constraint on these signals depends on address width.**
  `payment.circom` constrains `recipient` and `token` only to be non-zero and
  to equal (or not equal) list entries. It has no `Num2Bits` on them, unlike
  `amount` and `daily_spent_before`, which carry `Num2Bits(64)`. A 248-bit
  value satisfies every constraint a 160-bit one did.
- **A range check is not needed either.**
  - The verifier refuses any signal `≥ r` ([groth16-on-soroban.md](groth16-on-soroban.md)).
  - The compliance module compares the 32 signal bytes with `f(payee)`, which
    it computes itself.
  - A prover therefore cannot substitute another representative of the same
    element.
- **Proved on the unchanged circuit and key.** Two proofs were made from the
  existing circuit with the development key built by `circuits/scripts/build.mjs`
  (zkey sha256 `4b647022…2280e`). In both, `token = f(USDC SAC, testnet)` and
  the whitelist and blocked list hold `f` values.

  | Proof | `recipient` | `is_compliant` | snarkjs | Soroban host | Testnet simulation |
  |---|---|---|---|---|---|
  | `compliant` | `f(usdc_issuer_testnet)`, a `G…` account | 1 | verifies | valid | valid |
  | `blocked` | `f(usdc_issuer_pubnet)`, on the blocked list | 0 | verifies | valid | valid |
  | `compliant` with `recipient` swapped for the blocked one | — | — | — | invalid | invalid |

  The files are in `contracts/probes/address_field_probe/circuit/`, written by
  `circuits/scripts/probe-vectors.mjs`. The `stellar_addresses` set of
  `groth16_probe/vectors.json` carries them in Soroban bytes.
- **Signals 2 and 4 keep their positions.** Only their meaning changes: from
  "the address as a field element" to "`f` of the address".

What does change, and in which issue:

- The explanation in `circuits/README.md`, "Addresses are one field element",
  is rewritten here.
- The circuit's comments and the test helpers' `addressToField`, which still
  build 20-byte inputs, change in [#20][i20].
- The prover's `addressToField` (`services/prover/src/hash.js`) and the
  policy package's (`packages/policy/src/commitment.ts`) become `f` in
  [#21][i21] and [#22][i22]. Both also document in their OpenAPI and README
  that list entries are `f` values.

The setup status is unchanged by this decision: the key is a development key,
and the ceremony ([#51][i51]) runs over the circuit as [#20][i20] freezes it
([docs/disclosure/zk-setup-status.md](../disclosure/zk-setup-status.md)).
