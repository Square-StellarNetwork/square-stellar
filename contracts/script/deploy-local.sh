#!/usr/bin/env bash
#
# The kernel on a local quickstart network (#19, B12; the network is #43).
# `contracts/script/deploy.sh` does the work; this fixes the endpoint and the
# passphrase the `stellar/quickstart` image starts with, so a local stack is
# one command with nothing to remember.
set -euo pipefail

export RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
export NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
export SQUARE_DEPLOYER="${SQUARE_DEPLOYER:-square-local-deployer}"

exec "$(dirname "$0")/deploy.sh" local
