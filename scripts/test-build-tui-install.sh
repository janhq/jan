#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
original_home="$HOME"
test_home="$(mktemp -d)"
trap 'rm -rf "$test_home"' EXIT

export HOME="$test_home"
export CARGO_HOME="${CARGO_HOME:-$original_home/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$original_home/.rustup}"

"$repo_root/build-tui.sh" debug
"$repo_root/build-tui.sh" debug

python3 - "$HOME/.local/bin/jan" <<'PY'
import subprocess
import sys

result = subprocess.run([sys.argv[1], "--version"], capture_output=True, check=True, text=True, timeout=5)
assert result.stdout.startswith("jan "), result.stdout
PY
