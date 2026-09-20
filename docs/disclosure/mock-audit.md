# The mock audit, and the guard that keeps it true

**Status:** first full scan 2026-09-20, for [#68][i68]. Enforced from then on by
`.github/scripts/check-product-path.sh`, run in `security.yml` as "no mocks on the
product path".

[i68]: https://github.com/Square-StellarNetwork/square-stellar/issues/68

Judging criterion 2 is *"The application is deployed on Stellar Testnet with real
functionality—not mocked or hardcoded"*, and the team's rule is stricter than that: one
test double anywhere a judge can reach ends the submission. This file records what the
repository actually contains, where the line between the product and its test harness
runs, and what now enforces it.

## The line, and why it is drawn there

**A test double in a test is how a test is written.** `env.mock_all_auths()` in the
kernel's own `src/test.rs` is not a mock in the product; it is how `soroban-sdk` says
"assume authorization succeeded" while a state machine is under test. Forbidding it
would not make the product more real — it would make the kernel untested, which is
worse.

**Nothing that ships may contain one.** The product path is what a judge can reach: the
deployed contract, the SDK the app and the agent talk to it through, the app, the agent
runtime and the website. It is listed, line by line, in
[`product-path.txt`](./product-path.txt), and the guard reads that file rather than
carrying its own copy.

Rust makes the boundary slightly awkward and the guard handles it explicitly: a crate's
unit tests live inside its own `src/`, behind `#[cfg(test)]`, so `src/test.rs` is a test
harness by construction whatever directory it sits in. It never reaches the uploaded
Wasm, and the guard skips it by name.

**The earlier version is out of scope, deliberately.** Square was built for Arc (EVM) and
Solana first and that code is still in the tree, marked as such in its own READMEs. It is
not deployed, not demonstrated and not reachable from the product. Holding it to the
product's rule would achieve nothing except to invite deleting the evidence of where the
project came from.

## What the first scan found

156 product-path files, 14 patterns. **Clean** — no `mock`, `dummy`, `stubbed`, `fake…`
identifier, no `lorem ipsum`, `TBD`, `changeme`, `YOUR_…`, `<your-…>`, `example.com`, no
`TODO`/`FIXME`/`XXX`/`HACK` comment, and no zero address or all-zero 32-byte hash.

Two things had to be settled to get there, and both are recorded rather than quietly
fixed:

| | |
|---|---|
| `contracts/common/src/lib.rs` | Its module doc said the `test-support` **mocks** are phase 2. Honest prose, in a shipped library. Reworded to "doubles" — the sentence loses nothing, and an exception marker in the kernel's shared crate is a worse precedent than a synonym. |
| `contracts/contracts/square_job/src/test.rs` | Twelve `MockAuth`/`mock_all_auths` uses, all inside `#[cfg(test)]`. This is the case the boundary exists for; the guard skips in-crate Rust tests by name. |

### What the patterns deliberately do not catch

There is no bare `placeholder` pattern. An HTML input's `placeholder=` attribute is a
real label for a real field and the app has twelve of them; `packages/core`'s
`job.ts` also describes building a bindings `Spec` "with placeholder options", which is
an accurate description of a real technique. A guard that made those unwritable would be
routed around by deleting the guard.
[`product-path-allowed.txt`](./guard-fixtures/product-path-allowed.txt) holds the lines
that must stay writable, and the self-test fails if any pattern touches one.

`TODO` is anchored to a comment marker for the same reason: the scan folds case, and
`type StepState = "todo" | "done" | "error"` is a legitimate union of string literals.
The marker is what tells an admission apart from a value.

## What the guard cannot see, and what to do about it

A pattern scan finds a value that names nothing. It cannot find a call that *goes*
nowhere, and that is the failure mode this project has actually hit twice.

On 2026-09-20 the app branch for [#39][i39] was found to call twelve kernel methods that
the deployed contract does not have — `get_job_record`, `net_payout`, `payment_token`,
`platform_fee_bp`, `evaluator_fee_bp`, `treasury`, `settlement_horizon`, `challenge_end`,
`is_disputed`, `current_window`, `set_provider`, `dispute` — because it was written from
an earlier specification of the kernel rather than from the one that shipped. Nothing in
it is a mock, and every pattern here passes over it; pointed at
`CATY3ZGN…ZVII` the job list and the job page would fail on the first read. By criterion
2 that is worse than a mock: it is an application with no real functionality at all.

[i39]: https://github.com/Square-StellarNetwork/square-stellar/issues/39

The structural answer is not another pattern. It is that a caller should not be able to
name a method the contract does not export:

- `packages/core/src/stellar/job.ts` already has this property. It encodes through the
  generated bindings' `Spec`, so a method the kernel does not have is a compile error
  rather than a runtime one.
- Anything that hand-rolls `ScVal`s and passes a method name as a string gives that up.
  The remedy is to route it through the bindings too, which is what
  [#39][i39] was told.

A check that reads the deployed contract's spec and asserts every method name a product
path calls is in it would close the gap mechanically. It is not in this change because
the app it would guard is not on `main` yet; it belongs with the branch that lands.
`npm --prefix packages/core run check:deployed-wasm` already does the neighbouring job —
it asserts the record, the contract instance and this tree's build are the same Wasm.

## Running it

```console
$ .github/scripts/check-product-path.sh              # self-test, then scan
$ .github/scripts/check-product-path.sh --self-test  # the guard alone
$ .github/scripts/check-product-path.sh --files      # what it considers the product
$ .github/scripts/check-product-path.sh --list       # patterns and path prefixes
```

It self-tests before it scans: every line of
[`product-path-violations.txt`](./guard-fixtures/product-path-violations.txt) must be
caught and every line of
[`product-path-allowed.txt`](./guard-fixtures/product-path-allowed.txt) must not be, so
an emptied pattern list or an emptied path list fails loudly instead of reporting green
over a repository it never read.

A deliberate, reviewed exception is marked `ci-allow-mock` on the line itself, never on
the file, so it appears in the diff that introduces it and has to be argued for there.
There are none today.

## Before submission

The last pass belongs to the submission checklist ([#65][i65]): run the guard on the
exact commit that is submitted, with the app branch merged, and paste the output. The
scan is cheap and the failure it prevents is total.

[i65]: https://github.com/Square-StellarNetwork/square-stellar/issues/65
