#!/usr/bin/env bash
#
# The kernel on Stellar Testnet (#19, B12; the run and its record are #45).
# `contracts/script/deploy.sh` does the work; this fixes testnet's endpoint
# and passphrase and refuses to run against anything else, because the salt
# is fixed and a deployment sent to the wrong network still succeeds.
set -euo pipefail

export RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export SQUARE_DEPLOYER="${SQUARE_DEPLOYER:-square-testnet-deployer}"

exec "$(dirname "$0")/deploy.sh" testnet
