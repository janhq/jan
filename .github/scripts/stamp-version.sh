#!/usr/bin/env bash
# The one place a build's version is written into the source tree.
#
#   stamp-version.sh VERSION   write VERSION into every manifest a release
#                              build reads it from, then verify the result
#   stamp-version.sh --check   fail if the committed manifests the app and the
#                              `jan` CLI report their version from disagree
#
# Every desktop build template calls this instead of carrying its own list,
# because per-template lists are how src-tauri/jan-cli/Cargo.toml was missed
# and `jan --version` kept printing 0.8.5 on 0.8.6+ (janhq/jan-internal#454).
#
# Stamping needs jq and ctoml; --check needs only jq, so a plain runner can
# guard the committed tree.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# `jan --version` falls back to env!("CARGO_PKG_VERSION") inside app_lib, which
# is src-tauri/Cargo.toml's version, not jan-cli's; the CLI crate's own version
# is what Cargo.lock and `cargo install` report. Both, plus the desktop's
# tauri.conf.json, must agree, so these are the files --check compares. The
# plugin manifests and web-app/package.json are stamped too but carry their
# own versions between releases, so they are not part of the check.
CHECKED_TOML="src-tauri/Cargo.toml src-tauri/jan-cli/Cargo.toml"
CHECKED_JSON="src-tauri/tauri.conf.json"
STAMPED_TOML="$CHECKED_TOML
  src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
  src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml"
STAMPED_JSON="$CHECKED_JSON
  web-app/package.json
  src-tauri/plugins/tauri-plugin-hardware/package.json
  src-tauri/plugins/tauri-plugin-llamacpp/package.json"

# [package].version only: a dependency table can also carry `version = ...`.
toml_version() {
  awk '/^\[/ { pkg = ($0 == "[package]") }
       pkg && /^version[ \t]*=/ { sub(/^[^"]*"/, ""); sub(/".*/, ""); print; exit }' "$1"
}

json_version() {
  jq -r '.version' "$1"
}

# Prints each checked manifest's version and fails unless they are all equal
# (to $1 when given).
check() {
  local want="${1:-}" f v ok=1
  for f in $CHECKED_TOML; do
    v="$(toml_version "$f")"
    echo "$f: $v"
    [ -n "$want" ] || want="$v"
    [ "$v" = "$want" ] || ok=0
  done
  for f in $CHECKED_JSON; do
    v="$(json_version "$f")"
    echo "$f: $v"
    [ "$v" = "$want" ] || ok=0
  done
  if [ "$ok" != 1 ]; then
    echo "::error title=version drift::these manifests must all carry version $want; bump them together (or run .github/scripts/stamp-version.sh VERSION)"
    return 1
  fi
}

stamp() {
  local version="$1" f tmp
  tmp="$(mktemp)"
  for f in $STAMPED_JSON; do
    jq --arg version "$version" '.version = $version' "$f" > "$tmp"
    mv "$tmp" "$f"
  done
  for f in $STAMPED_TOML; do
    ctoml "$f" package.version "$version"
  done
  echo "stamped $version:"
  check "$version"
}

case "${1:-}" in
  --check) check ;;
  ""|-*) echo "usage: $0 VERSION | --check" >&2; exit 2 ;;
  *) stamp "$1" ;;
esac
