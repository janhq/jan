#!/usr/bin/env bash
# Maps a pull request's changed files to the CI areas they can affect, so the
# Linter & Test and Rust Check workflows run only the jobs a change can break.
#
# Reads one path per line on stdin and prints key=value lines for
# $GITHUB_OUTPUT. `--all` ignores stdin and turns everything on: pushes,
# dispatches and an unreadable file list take that path, so a doubt runs more.
#
#   ts      lint + vitest
#   mlx     the mlx-extension suite, which vitest only runs on macOS
#   rust    the desktop app crate or a plugin: Rust suites on three OSes
#   cli     app_lib as the cli feature set compiles it
#   jan_cli the standalone jan-cli crate, which depends on app_lib
#   adk     the JavaScript and Python ADKs, which drive the jan binary
#   app     JSON list of rust-check `app` matrix configs to lint
#   crates  JSON list of rust-check `crates` matrix entries to lint
#
# The fan-out follows the path dependencies in each Cargo.toml: a crate is
# linted when it, or a crate it depends on, changes. app_lib takes utils,
# agent-tools, websearch and vector-db unconditionally; every other plugin is
# desktop-only, so it never reaches the cli feature set or jan-cli.
# Cases: changed-areas.test.sh.
set -euo pipefail

ts=false mlx=false rust=false cli=false jan_cli=false adk=false
declare -A crates=()

all_crates=(
  jan-cli
  plugins/tauri-plugin-agent-tools
  plugins/tauri-plugin-extensions
  plugins/tauri-plugin-hardware
  plugins/tauri-plugin-llamacpp
  plugins/tauri-plugin-rag
  plugins/tauri-plugin-vector-db
  plugins/tauri-plugin-websearch
  utils
)

everything() {
  ts=true mlx=true rust=true cli=true jan_cli=true adk=true
  local c
  for c in "${all_crates[@]}"; do crates[$c]=1; done
}

# A plugin, and the standalone crates that take it as a path dependency.
# tauri-plugin-mlx is a macOS-only target dependency with no matrix entry, so
# the app crate's own suites are what cover it.
plugin() {
  local name="$1"
  rust=true
  case "$name" in
    tauri-plugin-mlx) ;;
    tauri-plugin-hardware)
      crates[plugins/tauri-plugin-hardware]=1
      crates[plugins/tauri-plugin-llamacpp]=1
      ;;
    tauri-plugin-websearch)
      crates[plugins/tauri-plugin-websearch]=1
      crates[plugins/tauri-plugin-agent-tools]=1
      cli=true
      ;;
    tauri-plugin-agent-tools | tauri-plugin-vector-db)
      crates[plugins/$name]=1
      cli=true
      ;;
    *) crates[plugins/$name]=1 ;;
  esac
}

if [ "${1:-}" = "--all" ]; then
  everything
else
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      Makefile | rust-toolchain.toml | \
        .github/workflows/rust-check.yml | .github/workflows/jan-linter-and-test.yml | \
        .github/actions/changed-areas/* | .github/scripts/changed-areas*)
        everything
        ;;
      # test-rust consumes these too: its `make test-ci-rust` runs yarn install,
      # download:bin and build:icon (the Tauri CLI) before the Rust suites.
      package.json | yarn.lock | .yarnrc.yml)
        ts=true mlx=true rust=true adk=true
        ;;
      vitest.config.ts | core/* | extensions/mlx-extension/* | \
        src-tauri/plugins/package.json | src-tauri/plugins/yarn.lock | src-tauri/plugins/.yarnrc.yml)
        ts=true mlx=true
        ;;
      web-app/* | extensions/* | packages/extension-api/* | packages/extension-runtime/* | \
        extensions-samples/* | scripts/extensions-smoke.mjs)
        ts=true
        ;;
      src-tauri/plugins/*/*)
        name="${file#src-tauri/plugins/}"
        name="${name%%/*}"
        plugin "$name"
        # `make lint` builds every plugin's guest-js, and the llamacpp suite
        # scans all plugin TypeScript for raw invoke calls. llamacpp's lib.rs
        # also include_str!s its guest-js, so that side stays on as well.
        case "${file#src-tauri/plugins/"$name"/}" in
          guest-js/* | package.json | rollup.config.js | tsconfig.json | *.ts | *.tsx)
            ts=true
            case "$name" in
              tauri-plugin-mlx | tauri-plugin-llamacpp) mlx=true ;;
            esac
            ;;
        esac
        ;;
      src-tauri/utils/*)
        rust=true cli=true
        crates[utils]=1
        crates[plugins/tauri-plugin-llamacpp]=1
        ;;
      src-tauri/jan-cli/*)
        jan_cli=true
        ;;
      # tauri-plugin-llamacpp include_str!s fetch-engine-source.sh.
      src-tauri/build-utils/*)
        rust=true
        crates[plugins/tauri-plugin-llamacpp]=1
        ;;
      src-tauri/*)
        rust=true cli=true
        ;;
      # The committed schemas are include_str!ed by core::cli and jan-cli tests.
      protocol/*)
        cli=true
        ;;
      # adk_examples runs every example and checks the docs excerpts quoting them.
      examples/adk/* | docs/src/pages/docs/agent/*)
        jan_cli=true
        ;;
      adk/* | packages/adk/*)
        adk=true
        ;;
      # Everything `make test-ci-rust` runs besides cargo: the resource stubs,
      # the bundled-binary download and the icon build, plus coverage.
      scripts/stub-tauri-resources.mjs | scripts/rust-coverage.sh | \
        scripts/download-bin.mjs | scripts/build-windows-icon.mjs)
        rust=true
        ;;
    esac
  done
fi

[ "$cli" = true ] && jan_cli=true
if [ "$jan_cli" = true ]; then
  crates[jan-cli]=1
  adk=true
fi

json() {
  [ "$#" -gt 0 ] || { echo '[]'; return; }
  printf '%s\n' "$@" | LC_ALL=C sort | sed 's/.*/"&"/' | paste -sd, - | sed 's/.*/[&]/'
}

app=()
[ "$rust" = true ] && app+=(desktop e2e)
[ "$cli" = true ] && app+=(cli)

echo "ts=$ts"
echo "mlx=$mlx"
echo "rust=$rust"
echo "cli=$cli"
echo "jan_cli=$jan_cli"
echo "adk=$adk"
echo "app=$(json ${app[@]+"${app[@]}"})"
echo "crates=$(json ${crates[@]+"${!crates[@]}"})"
