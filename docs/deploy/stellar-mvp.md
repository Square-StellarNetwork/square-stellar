# Deploying the MVP kernel on Stellar

The runbook for `contracts/script/deploy.sh` (#19) and the lifecycle run that
proves it (#45). The MVP deploys **one** contract, `square_job`, paid in
native XLM. The other eight, USDC as the payment token and the 8004
registries are phase 2, and the record names them when they exist.

## Prerequisites

| | |
|---|---|
| `stellar` CLI | 27.1.0 ([stellar-target.md](../decisions/stellar-target.md)) |
| Rust | 1.98.1, target `wasm32v1-none`, from `contracts/rust-toolchain.toml` |
| Node | 20 or newer, for writing and validating the record |
| A key | `stellar keys generate --fund --network testnet square-testnet-deployer` |

The deployer pays the resource fees and, unless `SQUARE_OWNER` says otherwise,
becomes the kernel's owner: the account that receives the platform fee, may
`skim`, and may correct the TTL config when the network's values drift.

## Parameters

Defaults, all overridable from the environment:

| | Default | Why |
|---|---|---|
| `CHALLENGE_WINDOW` | `120` s | The window a client has to reject a submission |
| `PLATFORM_FEE_BPS` | `100` (1%) | Kept by the owner out of each payout |
| `LEDGER_CLOSE_MS` | `5000` | Testnet's and pubnet's `ledgerTargetCloseTimeMilliseconds` |
| `MIN_PERSISTENT_TTL` | `120960` | Testnet's `minPersistentTtl`, about seven days |
| `TOKEN_ASSET` | `native` | XLM: every account holds it, so no trustline stands in front of a job |
| `SQUARE_SALT` | sha256 of `square_job:mvp:v1` | Fixed, so a testnet reset reproduces the same id |

A contract cannot read the network's configuration, so the last two of the
TTL values are written in at deployment
([fees-and-ttl.md](../decisions/fees-and-ttl.md) decision 4). A wrong value
costs a restore, not funds, and `set_ttl_config` corrects it.

## The run

```bash
# Review the parameters without sending anything.
BROADCAST=0 contracts/script/deploy-testnet.sh

# Deploy.
contracts/script/deploy-testnet.sh
```

The script, in order:

1. **Asks the endpoint which network it is** and stops if it is not the one
   expected. The constructor makes no external call, so a deployment sent to
   the wrong network succeeds and the record is written under a network
   nobody deployed to. This is the guard for that.
2. Resolves the deployer and the owner.
3. Derives the payment token's SAC id from the asset and the passphrase. No
   network lookup: `deploymentFromJson` derives it again when the record is
   read and refuses a record that names a different id.
4. Builds, and records the Wasm's sha256.
5. Uploads, and **stops if the hash the network stored is not the sha256 of
   the file that was built**. A Wasm's hash on Soroban is the sha256 of its
   bytes; if they disagree the record would name a build nobody can reproduce.
6. Deploys at the fixed salt with the constructor arguments.
7. Reads `config`, `owner`, `ttl_config` and `job_counter` back with
   `--send=no`: what the chain stored, not what it was asked to store.
8. Writes `contracts/deployments/<network>.json`.

## The record, and the two places it lives

```json
{
  "network": "stellar:testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "ledger": 4760307,
  "contracts": { "square_job": "C…" },
  "token": { "code": "XLM", "contractId": "C…" },
  "wasm": { "square_job": "871ec2…" }
}
```

`contracts/deployments/<network>.json` is the record the deploy script writes.
`packages/core/src/stellar/deployments.ts` carries the copy compiled into the
SDK. **The two move together**, and
`packages/core/test/stellar/deployments.test.ts` fails when they do not.

After a deployment:

```bash
# The chain, the record and this working tree all name the same Wasm.
npm --prefix packages/core run check:deployed-wasm -- testnet

# One job end to end, with every transaction and fee recorded.
SQUARE_NETWORK=testnet npm --prefix packages/core run lifecycle:stellar
```

`check:deployed-wasm` compares three values and the third is the one that
catches a stack behind main: what the record says, what the contract instance
actually points at, and the sha256 of the Wasm in `contracts/target`. It
replaces `check:selectors`, which could only see a missing method.

## Local

```bash
contracts/script/deploy-local.sh
```

Same script against the `stellar/quickstart` network: endpoint
`http://localhost:8000/rpc` (`STELLAR_LOCAL_RPC_URL` in `packages/core`),
passphrase `Standalone Network ; February 2017`, record written to
`contracts/deployments/local.json`.

## Where the addresses live

A deployment is not finished when the script exits. Every place below names
the kernel, and a redeploy that updates some of them and not others is the
failure this list exists to prevent:

- `contracts/deployments/<network>.json`, written by the script
- `packages/core/src/stellar/deployments.ts`, the compiled-in copy
- the README's "Network" and "Square contracts" tables
- `site/src/lib/links.ts`, for the explorer links
- `app/`'s environment, through the SDK rather than by hand

## What this does not do yet

The eight remaining contracts, USDC as the payment token, the 8004
registries and the resource-fee table. They were phase 2, and phase 2 was
closed on 2026-09-20 (#48): the target is the MVP, payment in XLM.
