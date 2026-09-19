# Authorization and token flow on Soroban: no approve, explicit signers, trustlines

**Status:** decided in [#5][i5]. The table of who authorizes each write function
is applied by the kernel ([#9][i9]), the keeper evaluator ([#14][i14]),
arbitration ([#15][i15]), the claim market ([#16][i16]) and the screening
registry ([#17][i17]). The SDK side is in [#23][i23], the app in [#39][i39] and
fee sponsorship in [#27][i27]. It supersedes the EVM token flow of
[erc20-vs-native-usdc.md](erc20-vs-native-usdc.md). The testnet evidence below
is from 2026-09-19.

[i5]: https://github.com/Square-StellarNetwork/square-stellar/issues/5
[i9]: https://github.com/Square-StellarNetwork/square-stellar/issues/9
[i14]: https://github.com/Square-StellarNetwork/square-stellar/issues/14
[i15]: https://github.com/Square-StellarNetwork/square-stellar/issues/15
[i16]: https://github.com/Square-StellarNetwork/square-stellar/issues/16
[i17]: https://github.com/Square-StellarNetwork/square-stellar/issues/17
[i23]: https://github.com/Square-StellarNetwork/square-stellar/issues/23
[i27]: https://github.com/Square-StellarNetwork/square-stellar/issues/27
[i39]: https://github.com/Square-StellarNetwork/square-stellar/issues/39

## What changes from EVM

On EVM the design rests on two things.

- **`approve` + `safeTransferFrom`.**
  - `SquareJob.fund` pulls `client → kernel`.
  - `Arbitration.open` pulls `disputer → arbitration`.
  - `ClaimMarket.buy` pulls `buyer → seller`.
  - The app and the SDK therefore carry an "approve USDC" step
    (`packages/core/src/client.ts:475`, and the app copy "Approve USDC and fund").
- **`msg.sender` checks** for who may act.

Soroban has neither.

- **A token is a SEP-41 contract.**
  - For USDC it is the Stellar Asset Contract (SAC,
    [stellar-target.md](stellar-target.md)).
  - `transfer(from, to, amount)` calls `from.require_auth()`.
- **Authorization is a signed tree of calls.** It is an *authorization entry*
  that covers the invocation it names and every sub-invocation under it.
- **There is no `msg.sender`.** A contract learns who is acting from an
  `Address` argument and proves it with `address.require_auth()`.
- **Contract callers authorize themselves.** When the caller of a contract is
  itself a contract, `require_auth` for the caller's own address is satisfied
  by the call itself, with no signature.

## The decisions

1. **`fund` has no `approve` step.**
   - The kernel does `client.require_auth()`, then
     `token.transfer(&client, &env.current_contract_address(), &amount)`.
   - The client signs one authorization entry. It covers `fund` and, beneath
     it, the `transfer` into the kernel.
   - The SDK, the app, the hosted agent and the MCP server drop the approve
     step.
2. **`Arbitration.open` and `ClaimMarket.buy` work the same way.**
   - `disputer.require_auth()` + `token.transfer(&disputer, &arbitration, &bond)`.
   - `buyer.require_auth()` + `token.transfer(&buyer, &seller, &price)`.
   - When the dispute arrives through the keeper evaluator
     (`dispute → open → transfer`), one signature by the disputer covers all
     three calls.
3. **Withdrawals** (`withdraw_to`) are the contract paying out:
   `token.transfer(&contract, &to, &amount)`.
   - **A `G…` recipient needs a USDC trustline, or the transfer fails.**
   - **A `C…` recipient does not.**
   - The SDK detects a missing trustline before it withdraws: a simulated
     `balance(to)` on the SAC fails with `TrustlineMissingError` (#13).
   - It then offers the fix: the SAC's `trust(to)` (CAP-0073, Protocol 26).
     `trust` runs inside Soroban under `to`'s own authorization, so it is one
     simulated, signed invocation, not a classic operation the app would have
     to mix in.
   - The error is `TrustlineMissingError` in the SDK ([#23][i23]) and a guided
     step in the app ([#39][i39]).
4. **Every write function takes the acting address as an explicit parameter**
   and calls `require_auth()` on it.
   - For example `set_provider(client: Address, job_id, provider)` checks
     `client.require_auth()` and compares with the stored record.
   - The signer's authorization entry is independent of who submits the
     transaction. A relayer or fee-bump source can submit it and pay the fee,
     which is the basis of fee sponsorship ([#27][i27]).
5. **A contract evaluator needs no signature.**
   - `keeper_evaluator.finalize` calls `square_job.complete(evaluator = keeper_evaluator, …)`.
   - The kernel's `evaluator.require_auth()` is satisfied because the caller
     *is* the evaluator contract.
   - A human evaluator (`G…`) signs the same function.
6. **The screener authorizes instead of signing EIP-712** ([#17][i17]).
   - `screener.require_auth()` replaces the EIP-712 `Screening` signature and
     `ECDSA.recoverCalldata`.
   - "Signed offline, submitted by anyone" is what an authorization entry
     already is (decision 4). No separate signature scheme is kept.
7. **Amounts are `i128` at contract boundaries and `u64` in records.**
   - `i128` because SEP-41 uses it; `u64` as the EVM `uint64 budget` was.
   - At 7 decimals, 2^64 base units are about 1.84 trillion USDC. That matches
     the circuit's `Num2Bits(64)` bound.
   - A negative or over-`u64` amount is refused at the boundary before it
     reaches storage.

## Authorization trees, as testnet recorded them

**How this was measured.** `contracts/probes/auth_probe` is one contract that
plays the three roles the decisions rely on: `fund`, `dispute`/`open`, and
`finalize`/`complete`.

- It was deployed twice to testnet: as the kernel
  `CCRIALS4QIRS52ZWBP2VAPBIVNKYC23D3IARZKCSNPY6WD5RZHONZIFY` and as the
  arbitration contract `CAQXOB4562ZGVUQNT7FMNVKZVYC4ASU57Y3NQCV7VU4VIH7QDYK5N6BZ`.
- Its Wasm sha256 is `b50d7e36…bb9d3`.
- It was simulated against the real native-XLM SAC
  `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.

The SAC's authorization logic is the same for every classic asset; the USDC
case below differs only in the trustline. Each tree below is the
`simulateTransaction` output of `contracts/probes/scripts/auth-testnet.mjs`.
The client is `GBGFKN6Q…XOQ3`.

**1. `fund`: no approve.** One entry, signed by the client:

```
kernel.fund(client, XLM, 10000000)
    XLM.transfer(client, kernel, 10000000)
```

1,098,006 instructions; `minResourceFee` 415,664 stroops.

**2. `dispute → open → transfer`: one signature for the whole chain.** One
entry, signed by the disputer:

```
kernel.dispute(disputer, arbitration, XLM, 5000000)
    arbitration.open(disputer, XLM, 5000000)
        XLM.transfer(disputer, arbitration, 5000000)
```

1,445,016 instructions; `minResourceFee` 417,197 stroops.

**3. A contract as evaluator: no entries at all.**

- `arbitration.finalize(kernel)` calls `kernel.complete(evaluator = arbitration)`.
- Simulation records **zero** authorization entries: the contract caller
  authorized itself.
- 670,458 instructions; `minResourceFee` 13,200 stroops.

**4. A `G…` evaluator must sign.** `kernel.complete(evaluator = client)` called
directly records one entry, signed by the client, for `kernel.complete(client)`.

**5. No trustline.**

- `fund(client, USDC, 1)` from an account without a USDC trustline is
  refused by the host with `Error(Contract, #13)`.
- `#13` is the SAC's `TrustlineMissingError`
  (`soroban-env-host-27.0.1/src/builtin_contracts/contract_error.rs`).
- On a fresh account, `USDC.balance(account)` fails with the same error.
- `USDC.trust(account)` simulates cleanly: one entry, the account's own
  authorization, 228,235 instructions, `minResourceFee` 23,747 stroops.

**6. Signer and submitter are different accounts.** `fund` was also sent for
real, and succeeded:

- the client (`GBGFKN6Q…XOQ3`) signed only its authorization entry;
- the payer (`GCYUOI4Z…272D`) built, submitted and paid the transaction;
- transaction `0dca3bf887508c0cb5bea31b1d57cd45cf955363024bc606dd3a0dfab4692249`,
  fee 0.0188125 XLM paid by the payer.

This is decision 4 on chain.

**What the fees above measure.**

- **Most of a transfer's fee is rent.** The real `fund` (tree 6) was charged
  188,125 stroops, and 170,136 of them are rent (`getTransaction`). The rent is
  for the new persistent balance entry the SAC writes for the receiving
  contract.
- **Recorded-auth simulations are upper bounds.** The `minResourceFee` figures
  in trees 1–4 come from simulations in recording mode, where the
  authorization is not yet signed, and they include the signer's nonce entry.
  For example, the same `complete` simulates at 217,204 stroops recorded but
  22,215 once signed with a 60-ledger expiry.
- **A keeper that submits its own authorization pays no nonce.**

Per-operation resource fees are tabulated in [fees-and-ttl.md](fees-and-ttl.md)
and [docs/deploy/resource-fees.md](../deploy/resource-fees.md).

## Who authorizes each write function

The EVM access rule of every state-changing function, as the Solidity contracts
implement it, becomes the `require_auth` below. "Contract" means the caller is
the named contract, so the call authorizes itself.

`require_auth()` on an argument only proves that the argument signed. Where a
row says "who must be the job's …", the contract also compares the argument
with the stored record and refuses a mismatch, as principle 4 above does for
`set_provider`. That comparison is the EVM `msg.sender != job.…` check
(`SquareJob.sol:85, 138, 153, 166, 191, 209, 251-253`), and without it any
signer, contracts included, would pass. The parameter types after the signer
are the ones [call-graph-on-soroban.md](call-graph-on-soroban.md#7-typed-parameters-per-action-the-proof-never-travels-in-them)
fixes: only `submit` and `complete` carry a params struct.

### `square_job`

| Function | Authorizes | Token movement |
|---|---|---|
| `create_job(client, provider, evaluator, expired_at, description, hook)` | `client` | — |
| `set_provider(client, job_id, provider)` | `client`, who must be the job's client | — |
| `set_budget(caller, job_id, amount)` | `caller`, who must be the client or the provider | — |
| `fund(client, job_id, expected_budget)` | `client`, who must be the job's client | `client → square_job` (budget) |
| `set_compliance_proof(client, job_id, proof)` | `client`, who must be the job's client | — |
| `submit(provider, job_id, deliverable, params: SubmitParams)` | `provider`, who must be the job's provider | — |
| `complete(evaluator, job_id, reason, params: CompleteParams)` | `evaluator`, who must be the job's evaluator: the keeper evaluator contract (invoker auth), or a `G…` evaluator who signs | — (credits only) |
| `reject(caller, job_id, reason)` | `caller`, who must be the job's client while Open, or the job's evaluator while Funded or Submitted | — (credits only) |
| `claim_refund(job_id)` | nobody: anyone may crank it after expiry | — (credits only) |
| `withdraw_to(account, to, amount)` | `account`, the holder of the balance | `square_job → to` |
| `set_fees`, `set_hook_whitelist`, `skim` | owner ([upgradeability-and-governance.md](upgradeability-and-governance.md)) | `skim`: `square_job → to` |

### `keeper_evaluator`

| Function | Authorizes | Token movement |
|---|---|---|
| `finalize(caller, job_id)` | `caller`, who receives the fee; anyone may crank | fee: `square_job → caller`, through `withdraw_to` with the keeper evaluator as the balance holder (invoker auth) |
| `dispute(client, job_id, evidence)` | `client`, who must be the job's client; the same entry covers `arbitration.open` and the bond `transfer` | `client → arbitration` (bond) |
| `apply_rejection(job_id, resolution)` | the arbitration contract (invoker auth) | — |
| `finalize_decided(caller, job_id)` | `caller`; anyone may crank | fee as in `finalize` |
| `configure_windows`, `set_finalize_grace`, `set_arbitration` | owner | — |

### `arbitration`

| Function | Authorizes | Token movement |
|---|---|---|
| `open(job_id, disputer, budget, resolve_by, evidence)` | the keeper evaluator (invoker auth) and `disputer` | `disputer → arbitration` (bond) |
| `vote(arbiter, job_id, outcome, provider_bps)` | `arbiter`, who must be in the dispute's arbiter set version | — |
| `lapse(job_id)` | nobody: anyone after `resolve_by` | — |
| `settle_bond(job_id)` | nobody: anyone | credits only |
| `withdraw_to(account, to, amount)` | `account` | `arbitration → to` |
| `set_arbiters`, `set_bond_parameters` | owner | — |

### `claim_market`

| Function | Authorizes | Token movement |
|---|---|---|
| `list(seller, job_id, price)` | `seller`, who must be the job's provider | — |
| `buy(buyer, job_id, expected_price, salt, eligibility)` | `buyer` | `buyer → seller` (price), direct |
| `cancel(seller, job_id)` | `seller`, who must be the listing's seller (`ClaimMarket.sol:76`) | — |

### `square_hook`, `compliance_module`, `policy_registry`, `screening_registry`

| Function | Authorizes |
|---|---|
| `square_hook.before_action`, `after_action` | the kernel (invoker auth); the hook checks the caller is its kernel |
| `square_hook.record_expiry(job_id)` | nobody: anyone after expiry |
| `compliance_module.check_release(…)` | the registered hook (invoker auth, `hook.require_auth()`); see [call-graph-on-soroban.md](call-graph-on-soroban.md) |
| `policy_registry.set_policy(poster, commitment, daily_limit)`, `set_buyer_root(poster, root)` | `poster`, for their own address |
| `policy_registry.record_spend(spender, poster, amount)` | `spender`, which must be in the spender set: the compliance module (invoker auth) |
| `screening_registry.submit(screener, record)`, `submit_many(screener, records)` | `screener`, which must be an active screener; any account may submit the signed entry |
| owner setters of each | owner |

## Trustlines

Every `G…` account that **receives** USDC needs a USDC trustline before it
receives. Every `G…` account that **pays** USDC must hold a trustline with a
balance. `C…` contracts need none.

| Role | Why it needs a USDC trustline |
|---|---|
| Client | pays the budget in `fund`; receives refunds (`reject`, `claim_refund`) through `withdraw_to` |
| Provider, or the payee the claim market sets | receives the payout through `withdraw_to` |
| Disputer (the client) | pays the bond in `open`; receives it back through arbitration's `withdraw_to` |
| Buyer | pays the price in `buy` |
| Seller (the provider listing a receivable) | receives the price directly from the buyer in `buy` |
| Keeper | receives the evaluator fee through `withdraw_to` |
| Human evaluator (`G…`) | receives the evaluator fee |
| Platform treasury | receives the platform fee |

**Account reserves.**

- An account's minimum balance is `(2 + subentries) × 0.5 XLM`, and a
  trustline is one subentry
  ([Lumens](https://developers.stellar.org/docs/learn/fundamentals/lumens)).
- A new `G…` account that opens a USDC trustline therefore needs at least
  1.5 XLM.
- Signing an authorization entry needs no XLM: the submitter pays the fee
  (tree 6).
- Sponsored reserves can cover an account's reserves as well. That belongs to
  fee sponsorship ([#27][i27]).

## "Approve" leaves the Stellar path

**Where `approve` appears today.** On the EVM path it appears in
`packages/core/src/client.ts:475` (`approve`), `packages/core/src/cctp/index.ts:375`,
`packages/aa/scripts/square.ts:125`, and the app's copy "Approve USDC and fund"
(`app/src/components/views/NewJobView.tsx:277`, `app/src/lib/inbox.ts:17`).

**It does not appear anywhere on the Stellar path in this change:**

- the Soroban contracts;
- `contracts/common`;
- the generated bindings in `packages/core/src/bindings`.

`git grep -i approve` over them returns nothing.

**Keeping it that way.** [#23][i23] and [#39][i39] replace the EVM clients.
They must keep the Stellar path free of an approve step, and they remove the
copy above.

Uses of "approve" that mean something else stay: "approve buyers", the
institution's buyer eligibility list ([buyer-eligibility.md](buyer-eligibility.md)).

## Relation to the earlier decision

[erc20-vs-native-usdc.md](erc20-vs-native-usdc.md) chose the ERC-20 interface
over Arc's native USDC and fixed 6 decimals. On Stellar:

- **Fees are paid in XLM, not in the payment token.** The Arc question of
  paying gas in USDC does not arise.
- **The payment token is the USDC SAC**, with no approve and 7 decimals.
- **Its core reasoning still holds.** A token `transfer` does not call back
  into the recipient, and amounts must stay under the circuit's 64-bit bound.
