#!/usr/bin/env bash
# Fix: "rustup could not choose a version of cargo" / failed extract (ENOSPC) / bad interactive install.
#
# Before running: free disk space (~600 MiB+ under $HOME). Check: df -h ~
#
# Never type random letters into rustup prompts — use defaults (press Enter) or this script only.
set -euo pipefail

avail_kb="$(df -Pk "$HOME" | awk 'NR==2 {print int($4)}')"
if [[ "$avail_kb" -lt $((600 * 1024)) ]]; then
  echo "ERROR: Only $((avail_kb / 1024)) MiB free on $HOME's filesystem. Rust stable needs more." >&2
  echo "  sudo apt clean && sudo journalctl --vacuum-time=3d" >&2
  echo "  rm -rf ~/.cache/pip ~/.cache/typescript 2>/dev/null; du -sh ~/.rustup ~/.cargo 2>/dev/null" >&2
  exit 1
fi

export PATH="${HOME}/.cargo/bin:${PATH}"

if [[ -x "${HOME}/.cargo/bin/rustup" ]]; then
  echo "Removing broken/partial toolchains (keeps rustup)..."
  while read -r line; do
    tc="${line%% *}"
    if [[ -n "$tc" && "$tc" != "no" ]]; then
      rustup toolchain uninstall "$tc" 2>/dev/null || true
    fi
  done < <(rustup toolchain list 2>/dev/null || true)
fi

echo "Installing stable toolchain (minimal profile, non-interactive)..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --default-toolchain stable \
  --profile minimal

# shellcheck source=/dev/null
source "${HOME}/.cargo/env"

rustup default stable
cargo -V
rustc -V
echo "Rust OK. Run: cd ~/jan && make dev"
