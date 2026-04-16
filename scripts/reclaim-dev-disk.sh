#!/usr/bin/env bash
# Free space when builds fail with "no space left on device" (Vite, rustup, etc.).
# Safe: removes caches and redownloadable artifacts under $HOME and this repo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rm -rf "${REPO_ROOT}/scripts/dist"
rm -rf "${REPO_ROOT}/web-app/node_modules/.vite"
rm -rf "${REPO_ROOT}/src-tauri/target"
rm -rf "${HOME}/.yarn/berry/cache"
rm -rf "${HOME}/.cargo/registry/cache"
rm -rf "${HOME}/.npm/_cacache"
rm -rf "${HOME}/.cache/pip" "${HOME}/.cache/typescript" 2>/dev/null || true

echo "Freed caches. Disk:"
df -h "${HOME}"
