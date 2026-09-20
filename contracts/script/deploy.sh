#!/usr/bin/env bash
#
# The MVP kernel deployment (#19, B12). One contract: build `square_job`,
# upload it, deploy it at a fixed salt, run its constructor, read back what
# the chain stored, and write `contracts/deployments/<network>.json` in the
# shape `packages/core/src/stellar/deployments.ts` reads.
#
# The salt is fixed on purpose. Stellar Testnet is reset a few times a year,
# and a deployment reproduced from the same deployer, the same Wasm and the
# same salt comes back at the same contract id, so the addresses in the
# README and in `@squaresdk/core` are reproduced by script rather than
# rediscovered (docs/decisions/stellar-target.md).
#
# The other eight contracts, USDC as the payment token and the 8004
# registries are phase 2. This deploys the kernel and names the asset it is
# paid in, which on the MVP is native XLM.
#
# Usage:
#   contracts/script/deploy.sh local
#   contracts/script/deploy.sh testnet
#
# Everything below can be overridden from the environment; the defaults are
# the parameters docs/deploy/stellar-mvp.md records.
set -euo pipefail

cd "$(dirname "$0")/.."
repo_root="$(cd .. && pwd)"

network="${1:-${SQUARE_NETWORK:-}}"
if [ -z "$network" ]; then
  echo "usage: $0 <local|testnet>" >&2
  exit 2
fi

case "$network" in
  local)
    # The path the stellar/quickstart image serves RPC on; the same value as
    # packages/core's STELLAR_LOCAL_RPC_URL (network.ts).
    default_rpc="http://localhost:8000/rpc"
    default_passphrase="Standalone Network ; February 2017"
    ;;
  testnet)
    default_rpc="https://soroban-testnet.stellar.org"
    default_passphrase="Test SDF Network ; September 2015"
    ;;
  *)
    echo "error: unknown network ${network}; expected local or testnet." >&2
    exit 2
    ;;
esac

RPC_URL="${RPC_URL:-$default_rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-$default_passphrase}"

# The deployer is a key the stellar CLI knows (`stellar keys generate --fund
# <name>`) or a secret in the environment. It pays the resource fees, and
# unless SQUARE_OWNER says otherwise it becomes the kernel's owner: the
# account that receives the platform fee, may `skim`, and may correct the TTL
# config when the network's values drift.
SQUARE_DEPLOYER="${SQUARE_DEPLOYER:-square-deployer}"
CHALLENGE_WINDOW="${CHALLENGE_WINDOW:-120}"
PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-100}"

# The two network values the kernel's TTL rules convert with. A contract
# cannot read the network's configuration, so the deploy script writes them in
# (contracts/common/src/ttl.rs, docs/decisions/fees-and-ttl.md decision 4).
# These are testnet's and pubnet's; `set_ttl_config` corrects them if they
# drift, and a wrong value costs a restore rather than funds.
LEDGER_CLOSE_MS="${LEDGER_CLOSE_MS:-5000}"
MIN_PERSISTENT_TTL="${MIN_PERSISTENT_TTL:-120960}"

# BROADCAST=0 walks every step and stops before the first transaction, which
# is how the parameters get reviewed without spending a testnet reset.
BROADCAST="${BROADCAST:-1}"

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "neither sha256sum nor shasum is on PATH; cannot record the Wasm hash."
  fi
}

json_field() {
  node -e '
    let body = "";
    process.stdin.on("data", (d) => (body += d));
    process.stdin.on("end", () => {
      const parsed = JSON.parse(body);
      if (parsed.error) {
        process.stderr.write(parsed.error.message ?? JSON.stringify(parsed.error));
        process.exit(1);
      }
      const value = process.argv[1].split(".").reduce((acc, key) => acc?.[key], parsed);
      if (value === undefined) {
        process.stderr.write(`no ${process.argv[1]} in the response`);
        process.exit(1);
      }
      process.stdout.write(String(value));
    });
  ' "$1"
}

command -v stellar >/dev/null 2>&1 || fail "the stellar CLI is not on PATH; docs/decisions/stellar-target.md pins 27.1.0."
command -v node >/dev/null 2>&1 || fail "node is not on PATH; the record is written with it."

step "endpoint"
# The endpoint comes from the environment, and a wrong one deploys somewhere
# else without complaint: the constructor makes no external call, so nothing
# reverts and the record is written under whatever network was actually
# reached. Ask the endpoint which network it is before anything is sent.
actual_passphrase="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}' | json_field "result.passphrase")" \
  || fail "$RPC_URL did not answer getNetwork; nothing was broadcast."

if [ "$actual_passphrase" != "$NETWORK_PASSPHRASE" ]; then
  echo "error: ${RPC_URL} is \"${actual_passphrase}\", not \"${NETWORK_PASSPHRASE}\"; nothing was broadcast." >&2
  echo "       Fix RPC_URL, or set NETWORK_PASSPHRASE on purpose." >&2
  exit 1
fi
echo "${RPC_URL} is ${actual_passphrase}"

step "deployer"
deployer_address="$(stellar keys address "$SQUARE_DEPLOYER" 2>/dev/null || true)"
if [ -z "$deployer_address" ]; then
  echo "error: no key named ${SQUARE_DEPLOYER}; nothing was broadcast." >&2
  echo "       Create and fund one with: stellar keys generate --fund --network ${network} ${SQUARE_DEPLOYER}" >&2
  exit 1
fi
SQUARE_OWNER="${SQUARE_OWNER:-$deployer_address}"
echo "deployer ${deployer_address}"
echo "owner    ${SQUARE_OWNER}"

step "payment token"
# The MVP is paid in native XLM: every account holds it, so no trustline
# stands between a client and a job it wants to fund. USDC is phase 2, and
# the record's `token` is what the constructor was actually given.
TOKEN_ASSET="${TOKEN_ASSET:-native}"
TOKEN_CODE="${TOKEN_CODE:-XLM}"
# `deploymentFromJson` requires the issuer of anything that is not XLM: a code
# alone does not say which asset it is, and two issuers can use the same code.
# TOKEN_ASSET is `native` or `CODE:ISSUER`, so the issuer is already here.
case "$TOKEN_ASSET" in
  native) TOKEN_ISSUER="" ;;
  *:*)    TOKEN_ISSUER="${TOKEN_ASSET#*:}" ;;
  *)      fail "TOKEN_ASSET must be 'native' or 'CODE:ISSUER'; got ${TOKEN_ASSET}" ;;
esac
# A SAC id is derived from the asset and the passphrase, not looked up, so
# this needs no account and sends nothing. `deploymentFromJson` derives it
# again when the record is read, and refuses a record that names another id.
token_contract="$(stellar contract id asset \
  --asset "$TOKEN_ASSET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE")" || fail "could not derive the SAC id for ${TOKEN_ASSET}."
echo "${TOKEN_CODE} SAC ${token_contract}"

step "build"
# Only the kernel: the workspace also holds the probes and eight skeletons.
stellar contract build --package square_job
wasm="target/wasm32v1-none/release/square_job.wasm"
[ -f "$wasm" ] || fail "${wasm} was not built."
wasm_sha256="$(sha256_of "$wasm")"
echo "square_job.wasm sha256 ${wasm_sha256}"

# The salt is derived from a label rather than typed as a magic constant, so
# what produced the contract id is readable here and reproducible anywhere.
SQUARE_SALT="${SQUARE_SALT:-$(printf 'square_job:mvp:v1' | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } | cut -d' ' -f1)}"
echo "salt ${SQUARE_SALT}"

if [ "$BROADCAST" != "1" ]; then
  echo
  echo "BROADCAST=${BROADCAST}: stopping before the first transaction. Nothing was sent."
  echo "  constructor: owner=${SQUARE_OWNER} token=${token_contract} challenge_window=${CHALLENGE_WINDOW}"
  echo "               platform_fee_bps=${PLATFORM_FEE_BPS} ledger_close_ms=${LEDGER_CLOSE_MS} min_persistent_ttl=${MIN_PERSISTENT_TTL}"
  exit 0
fi

step "upload"
uploaded_hash="$(stellar contract upload \
  --wasm "$wasm" \
  --source-account "$SQUARE_DEPLOYER" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE")"
echo "wasm hash ${uploaded_hash}"

# A Wasm's hash on Soroban is the sha256 of the bytes. If the chain disagrees
# with the file we just hashed, the record would name a build nobody can
# reproduce, so stop before the deploy rather than write it.
if [ "$uploaded_hash" != "$wasm_sha256" ]; then
  fail "the network stored ${uploaded_hash} but ${wasm} hashes to ${wasm_sha256}; the record would be wrong."
fi

step "deploy"
contract_id="$(stellar contract deploy \
  --wasm-hash "$uploaded_hash" \
  --salt "$SQUARE_SALT" \
  --source-account "$SQUARE_DEPLOYER" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --owner "$SQUARE_OWNER" \
  --token "$token_contract" \
  --challenge_window "$CHALLENGE_WINDOW" \
  --platform_fee_bps "$PLATFORM_FEE_BPS" \
  --ledger_close_ms "$LEDGER_CLOSE_MS" \
  --min_persistent_ttl "$MIN_PERSISTENT_TTL")"
echo "square_job ${contract_id}"

step "reads"
# What the chain stored, not what we asked it to store. `--send=no` simulates
# and prints the return value without a transaction.
for method in config owner ttl_config job_counter; do
  printf '%-12s ' "$method"
  stellar contract invoke \
    --id "$contract_id" \
    --source-account "$SQUARE_DEPLOYER" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --send=no \
    -- "$method"
done

step "record"
ledger="$(curl -sS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | json_field "result.sequence")"

record="${repo_root}/contracts/deployments/${network}.json"
node -e '
  const { writeFileSync } = require("node:fs");
  const [file, network, passphrase, ledger, kernel, code, tokenContract, wasmSha, issuer] = process.argv.slice(1);
  const record = {
    network: `stellar:${network}`,
    networkPassphrase: passphrase,
    ledger: Number(ledger),
    contracts: { square_job: kernel },
    token: issuer ? { code, issuer, contractId: tokenContract } : { code, contractId: tokenContract },
    wasm: { square_job: wasmSha },
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
' "$record" "$network" "$NETWORK_PASSPHRASE" "$ledger" "$contract_id" "$TOKEN_CODE" "$token_contract" "$wasm_sha256" "$TOKEN_ISSUER"

cat "$record"
echo
echo "Wrote ${record}."
echo "Next: copy it into packages/core/src/stellar/deployments.ts (the two move together,"
echo "      and packages/core/test/stellar/deployments.test.ts asserts they agree), then"
echo "      npm --prefix packages/core run check:deployed-wasm -- ${network}"
