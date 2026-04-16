#!/usr/bin/env bash
# Run `make dev` with settings that often fix Yarn ETIMEDOUT / registry connect issues:
# - Prefer IPv4 (broken IPv6 routes are common on VMs)
# - Optional: YARN_NPM_REGISTRY_SERVER=https://registry.npmmirror.com (or your proxy mirror)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --dns-result-order=ipv4first"
else
  export NODE_OPTIONS="--dns-result-order=ipv4first"
fi

if [[ -n "${YARN_NPM_REGISTRY_SERVER:-}" ]]; then
  echo "npm registry: ${YARN_NPM_REGISTRY_SERVER}"
fi

exec make dev "$@"
