#!/usr/bin/env bash
# Cases for changed-areas.sh. Each feeds a file list on stdin and checks the
# outputs that matter for it. Run: bash .github/scripts/changed-areas.test.sh
set -euo pipefail

script="$(dirname "$0")/changed-areas.sh"
failures=0

check() {
  local name="$1" out="$2"
  shift 2
  local want
  for want in "$@"; do
    if ! grep -qxF -- "$want" <<< "$out"; then
      echo "FAIL $name: want $want, got:"
      sed 's/^/    /' <<< "$out"
      failures=$((failures + 1))
    fi
  done
}

# expect <name> <files, newline-separated> <key=value>...
expect() {
  local name="$1" files="$2"
  shift 2
  check "$name" "$(printf '%s\n' "$files" | bash "$script")" "$@"
}

none='crates=[]'
all_crates='crates=["jan-cli","plugins/tauri-plugin-agent-tools","plugins/tauri-plugin-extensions","plugins/tauri-plugin-hardware","plugins/tauri-plugin-llamacpp","plugins/tauri-plugin-rag","plugins/tauri-plugin-vector-db","plugins/tauri-plugin-websearch","utils"]'
all_app='app=["cli","desktop","e2e"]'

expect 'web-app only' 'web-app/src/routes/index.tsx' \
  ts=true mlx=false rust=false cli=false jan_cli=false adk=false 'app=[]' "$none"

expect 'extension packages and samples' 'packages/extension-api/src/index.ts
extensions-samples/hello-provider/src/index.ts' \
  ts=true mlx=false rust=false cli=false 'app=[]' "$none"

expect 'core reaches mlx-extension' 'core/src/index.ts' ts=true mlx=true rust=false

expect 'mlx-extension' 'extensions/mlx-extension/src/index.ts' ts=true mlx=true rust=false

# jan-cli depends on app_lib, so an app change lints and tests it too.
expect 'app crate source' 'src-tauri/src/core/agent/context.rs' \
  ts=false rust=true cli=true jan_cli=true adk=true "$all_app" 'crates=["jan-cli"]'

expect 'jan-cli only' 'src-tauri/jan-cli/src/main.rs' \
  ts=false rust=false cli=false jan_cli=true adk=true 'app=[]' 'crates=["jan-cli"]'

expect 'plugin guest-js' 'src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index.ts' \
  ts=true mlx=true rust=true cli=false 'app=["desktop","e2e"]' 'crates=["plugins/tauri-plugin-llamacpp"]'

# The raw-invoke guard scans every .ts/.tsx under src-tauri/plugins.
expect 'plugin TypeScript outside guest-js' 'src-tauri/plugins/tauri-plugin-rag/scripts/gen.ts' \
  ts=true rust=true

expect 'plugin Rust source is not TS' 'src-tauri/plugins/tauri-plugin-rag/src/lib.rs' \
  ts=false rust=true cli=false jan_cli=false adk=false 'crates=["plugins/tauri-plugin-rag"]'

expect 'utils fans out to its dependents' 'src-tauri/utils/src/lib.rs' \
  rust=true cli=true 'crates=["jan-cli","plugins/tauri-plugin-llamacpp","utils"]'

expect 'hardware is desktop-only' 'src-tauri/plugins/tauri-plugin-hardware/src/lib.rs' \
  rust=true cli=false jan_cli=false adk=false 'app=["desktop","e2e"]' \
  'crates=["plugins/tauri-plugin-hardware","plugins/tauri-plugin-llamacpp"]'

expect 'websearch reaches agent-tools and the CLI' 'src-tauri/plugins/tauri-plugin-websearch/src/lib.rs' \
  rust=true cli=true jan_cli=true "$all_app" \
  'crates=["jan-cli","plugins/tauri-plugin-agent-tools","plugins/tauri-plugin-websearch"]'

expect 'agent-tools reaches the CLI' 'src-tauri/plugins/tauri-plugin-agent-tools/src/lib.rs' \
  cli=true 'crates=["jan-cli","plugins/tauri-plugin-agent-tools"]'

expect 'mlx plugin has no matrix entry' 'src-tauri/plugins/tauri-plugin-mlx/src/lib.rs' \
  rust=true cli=false "$none"

expect 'build-utils reach llamacpp' 'src-tauri/build-utils/fetch-engine-source.sh' \
  rust=true cli=false 'crates=["plugins/tauri-plugin-llamacpp"]'

expect 'committed protocol schema' 'protocol/schema.json' \
  ts=false rust=false cli=true jan_cli=true adk=true 'app=["cli"]'

expect 'ADK cookbook page' 'docs/src/pages/docs/agent/adk.mdx' \
  rust=false cli=false jan_cli=true 'app=[]' 'crates=["jan-cli"]'

expect 'ADK example' 'examples/adk/hello.mjs' rust=false jan_cli=true

expect 'docs site' 'docs/src/pages/index.mdx' \
  ts=false mlx=false rust=false cli=false jan_cli=false adk=false 'app=[]' "$none"

expect 'unknown top-level file runs nothing' 'README.md' \
  ts=false rust=false jan_cli=false adk=false "$none"

expect 'JS ADK package' 'packages/adk/src/index.mjs' ts=false rust=false jan_cli=false adk=true

expect 'Python ADK' 'adk/python/jan/client.py' ts=false adk=true

# test-rust's asset step runs yarn install and the Tauri CLI, so the lockfile
# reaches it; the app clippy configs follow rust as well.
expect 'lockfile reaches TS, ADK and test-rust' 'yarn.lock' ts=true mlx=true rust=true adk=true

expect 'download-bin feeds test-rust' 'scripts/download-bin.mjs' ts=false rust=true

expect 'windows icon build feeds test-rust' 'scripts/build-windows-icon.mjs' ts=false rust=true

expect 'stub script feeds the Rust build' 'scripts/stub-tauri-resources.mjs' ts=false rust=true

for shared in Makefile rust-toolchain.toml .github/workflows/rust-check.yml \
  .github/workflows/jan-linter-and-test.yml .github/scripts/changed-areas.sh \
  .github/actions/changed-areas/action.yml; do
  expect "shared: $shared" "$shared" \
    ts=true mlx=true rust=true cli=true jan_cli=true adk=true "$all_app" "$all_crates"
done

# What a push, a dispatch or an unreadable file list gets.
check '--all' "$(bash "$script" --all < /dev/null)" \
  ts=true mlx=true rust=true cli=true jan_cli=true adk=true "$all_app" "$all_crates"

expect 'mixed PR unions its areas' "$(printf '%s\n' web-app/src/a.ts src-tauri/plugins/tauri-plugin-rag/src/lib.rs)" \
  ts=true rust=true cli=false 'crates=["plugins/tauri-plugin-rag"]'

expect 'empty list runs nothing' '' ts=false rust=false adk=false 'app=[]' "$none"

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "changed-areas: all cases pass"
