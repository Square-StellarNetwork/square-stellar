# Resource fees, measured on Stellar testnet

This page is the Stellar counterpart of [gas.md](gas.md), which records the Arc
deployment. Every figure is from a real simulation (`simulateTransaction`) or
from a transaction that was sent and read back (`getTransaction`). Each comes
from the evidence of [#2](https://github.com/Square-StellarNetwork/square-stellar/issues/2),
[#5](https://github.com/Square-StellarNetwork/square-stellar/issues/5) or
[#6](https://github.com/Square-StellarNetwork/square-stellar/issues/6), read on
2026-09-19. What the numbers mean for the keeper, and the TTL rules, are in
[fees-and-ttl.md](../decisions/fees-and-ttl.md).

## Units and the conversion

- **XLM.** 1 XLM = 10,000,000 stroops. A Soroban fee is the resource fee plus
  the inclusion fee.
- **Conversion to USDC.** USDC figures are converted at one real price. It was
  read from Reflector's "External CEXs & DEXs" oracle on testnet
  (`CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`) at **testnet
  ledger 4760697**, for oracle round **1789827000 (2026-09-19 14:10:00 UTC)**:
  - `lastprice(Other("XLM"))` = 20,090,072,950,292;
  - `lastprice(Other("USDC"))` = 100,008,274,363,637;
  - both have 14 decimals and a USD base, so **1 XLM = 0.2008841 USDC**.
- **The rule.** `USDC base units = ceil(stroops × 20,090,072,950,292 /
  100,008,274,363,637)`. It is the formula in
  [fees-and-ttl.md](../decisions/fees-and-ttl.md#decision-1-the-profitability-formula).
  Both tokens have 7 decimals.
- **Freshness.** The USDC column is valid for that round only. The keeper
  converts at the price of the moment and never reads this table.

"Read B" and "Write B" are the disk bytes the simulation declared. "—" means
that neither the evidence nor the read-back recorded the value.

## Measured

| # | Operation | Instructions | Read B | Write B | `minResourceFee` (stroops) | Charged (stroops) | USDC (of `minResourceFee`) | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | Groth16 `verify`, valid or invalid proof (probe) | 29,991,050 | 0 (2 entries: instance, code) | 0 | 40,108 | 30,591 = 30,451 non-refundable + 40 refundable + 100 inclusion (tx `9427354a…bd31`, ledger 4759823) | 0.0008058 | a2-testnet |
| 2 | Groth16 `verify`, one signal `≥ r` (refused before any curve arithmetic) | 496,462 | 0 | 0 | 19,462 | — | 0.0003910 | a2-testnet |
| 3 | Upload probe Wasm, 3,067 bytes | — | — | — | — | 5,141,142 (tx `c4096bb8…c3d4`) | 0.1032774 (of the charge) | a2-testnet |
| 4 | Create a contract from an uploaded Wasm | — | — | — | — | 27,062 (tx `ce6a23f9…f6d4`) | 0.0005437 (of the charge) | a2-testnet |
| 5 | `fund`: SAC `transfer` into a contract that holds no balance yet, auth recorded (unsigned) | 1,098,006 | — | — | 415,664 | — | 0.0083501 | a5-testnet |
| 6 | the same `fund`, signed and sent: declared resource fee 223,296 | 1,086,499 | 144 | 444 | 223,296 (declared) | 188,125 = 16,951 non-refundable + 171,074 refundable (170,136 of it rent) + 100 inclusion (tx `0dca3bf8…2249`, ledger 4760307) | 0.0044857 | read back for #6 |
| 7 | `fund` again, the contract's balance now existing, auth recorded | 1,119,901 | 144 | 444 | 224,738 | — | 0.0045147 | simulated for #6, ledger 4760561 |
| 8 | `dispute → open → transfer` into a contract with no balance, auth recorded | 1,445,016 | 144 | 444 | 417,197 (420,662 again at ledger 4760561) | — | 0.0083809 | a5-testnet; bytes from the #6 re-simulation |
| 9 | `finalize → complete`, the evaluator a contract, no signature | 670,458 | 0 | 0 | 13,200 | — | 0.0002652 | a5-testnet; the same at ledger 4760561 |
| 10 | `complete(evaluator)` by a `G…` evaluator, auth recorded | 891,646 | 144 | 76 | 214,582 (217,204 with a fresh account at ledger 4760651) | — | 0.0043107 | a5-testnet; bytes from the #6 re-simulation |
| 11 | the same `complete`, auth signed with expiration +60 ledgers | 878,622 | — | 76 | 22,215 | — | 0.0004463 | simulated for #6, ledger 4760651 |
| 11a | the same `complete`, the evaluator being the transaction's source account (source-account credentials, no nonce) | 380,823 | — | 0 | 13,276 | — | 0.0002667 | simulated for #6, ledger 4760776 |
| 12 | USDC SAC `trust(account)` | 228,235 | — | — | 23,747 | — | 0.0004771 | [auth-and-token-flow.md](../decisions/auth-and-token-flow.md) |
| 13 | Reflector `lastprice(Other("XLM"))` (simulated only; the keeper never sends it) | 865,625 | — | — | 13,547 | — | 0.0002722 | simulated for #6, ledger 4760697 |
| 14 | `ExtendFootprintTTL`, the 96-byte probe instance, TTL 120,143 → 241,920 | — | 0 | 0 | 35,771 | — | 0.0007186 | simulated for #6, ledger 4760637 |
| 15 | `ExtendFootprintTTL`, the probe instance, to 518,400 | — | 0 | 0 | 83,291 | — | 0.0016732 | same |
| 16 | `ExtendFootprintTTL`, the probe instance, to `maxEntryTtl` | — | 0 | 0 | 528,801 | — | 0.0106228 | same |
| 17 | `ExtendFootprintTTL`, the probe's code (3,160-byte entry), TTL 120,142 → 241,920 | — | 0 | 0 | 6,099,975 | — | 0.1225389 | same |
| 18 | `ExtendFootprintTTL`, the probe's code, to 518,400 | — | 0 | 0 | 19,915,659 | — | 0.4000740 | same |
| 19 | `ExtendFootprintTTL`, the probe's code, to `maxEntryTtl` | — | 0 | 0 | 149,437,695 | — | 3.0019659 | same |

Sources:

- **a2-testnet, a5-testnet.** The runs of `contracts/probes/scripts/groth16-testnet.mjs`
  and `auth-testnet.mjs`, quoted in
  [groth16-on-soroban.md](../decisions/groth16-on-soroban.md) and
  [auth-and-token-flow.md](../decisions/auth-and-token-flow.md). Rows 5, 8
  and 10 are those simulations.
- **The #6 reads.** The simulations and read-backs marked "for #6" were run
  against the same deployed probes, `CCRIALS4…ZIFY`, `CAQXOB45…N6BZ` and
  `CAQVJ4EX…TULE`, through `contracts/probes/scripts/lib/stellar.mjs`. None of
  them sent a transaction.

## What the rows say

- **Rent dominates wherever an entry is created.**
  - Row 6 paid 170,136 stroops of rent out of 188,125. The rent was for the
    SAC's new 216-byte balance entry, created with 518,400 ledgers (30 days) of
    life.
  - Row 7 is the same call once the balance exists. The simulated fee falls by
    the size of that rent, and what is left is mostly row 10's nonce.
- **Recorded authorization overstates the fee.** Compare rows 10 and 11: the
  same call, instructions within 1.5 %, and 217,204 against 22,215 stroops. The
  difference is the temporary auth nonce, priced for a long lifetime until a
  real signature expiration is known. That is an inference; the RPC
  documentation does not state it. So a fee shown to a user must come from a
  simulation after signing.
- **The keeper pays no nonce.** In row 9 the evaluator is the calling contract.
  `finalize(caller, job_id)` needs `caller`'s authorization
  ([auth-and-token-flow.md](../decisions/auth-and-token-flow.md)). When the
  keeper is both `caller` and the transaction source, simulation records
  source-account credentials and writes nothing (row 11a).
- **Code TTL is the expensive entry.** Rows 17 to 19 cost about 50 stroops per
  ledger for a 3,160-byte module. CAP-0066 prices contract code rent on the
  instantiated module's in-memory size, which can be "up to 40x the size" of the
  ledger entry ([CAP-0066](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md)).
  The instance (rows 14 to 16) is two orders of magnitude cheaper. That is why
  ordinary calls extend the instance only and the keeper's sweep extends code
  ([fees-and-ttl.md](../decisions/fees-and-ttl.md#instance-and-code)).
- **Limits.** Testnet `txMaxInstructions` is 400,000,000, so one Groth16
  verification uses 7.5 %.

## Not measured yet

These operations need the contracts of the B cluster, and no figure is given
for them until those contracts run on testnet. The table above covers probes
only: a probe `fund` or `finalize` does not write a job record, run a hook,
extend TTLs or move USDC.

| Operation | Contract issue | Why it cannot be measured today |
|---|---|---|
| `square_job.create_job`, `set_provider`, `set_budget` | [#9](https://github.com/Square-StellarNetwork/square-stellar/issues/9) | contract not written |
| `square_job.fund` (USDC into the kernel, hook before/after) | #9 | contract not written; row 6 is the SAC part alone |
| `square_job.submit`, `set_compliance_proof` | #9 | contract not written |
| `keeper_evaluator.finalize`, moduleless and gated (with the ≈30 M-instruction verification of row 1) | [#14](https://github.com/Square-StellarNetwork/square-stellar/issues/14) | contract not written; row 9 is the call shape alone |
| `keeper_evaluator.finalize_decided`, `dispute` | #14 | contract not written |
| `arbitration.open`, `vote`, `lapse`, `settle_bond`, `withdraw` | [#15](https://github.com/Square-StellarNetwork/square-stellar/issues/15) | contract not written |
| `claim_market.list`, `buy`, `cancel` | [#16](https://github.com/Square-StellarNetwork/square-stellar/issues/16) | contract not written |
| `square_job.reject`, `claim_refund`, `withdraw`, `withdraw_to` | #9 | contract not written |
| `square_hook.record_expiry` | [#13](https://github.com/Square-StellarNetwork/square-stellar/issues/13) | contract not written |
| `screening_registry.submit` | [#17](https://github.com/Square-StellarNetwork/square-stellar/issues/17) | contract not written |
| `RestoreFootprint` of an archived job entry | [#6](https://github.com/Square-StellarNetwork/square-stellar/issues/6) | no entry of ours has been archived yet |
| `ExtendFootprintTTL` of the nine contracts' code | [#37](https://github.com/Square-StellarNetwork/square-stellar/issues/37) | the Wasm does not exist; rows 17 to 19 are a 3,160-byte probe |
| The five end-to-end paths of gas.md (optimistic, disputed, expiry, cancel, receivable sold) | [#19](https://github.com/Square-StellarNetwork/square-stellar/issues/19) | all of the above |

When those contracts are deployed, each row above moves into the measured
table, with its transaction hash, ledger and the price round it was converted
at.
