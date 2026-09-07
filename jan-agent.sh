#!/usr/bin/env bash
# Convenience launcher for the locally-built Jan agent binary.
# Usage:
#   ./jan-agent.sh                 -> opens the interactive agent UI
#   ./jan-agent.sh agent status    -> forwards any args straight to `jan`
#   ./jan-agent.sh agent run "..." -> run a task headlessly

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAN_BIN="$DIR/src-tauri/resources/bin/jan"

if [ ! -x "$JAN_BIN" ]; then
  echo "error: jan binary not found or not executable at $JAN_BIN" >&2
  exit 1
fi

cd "$DIR/src-tauri"

if [ "$#" -eq 0 ]; then
  exec "$JAN_BIN" agent ui
else
  exec "$JAN_BIN" "$@"
fi
