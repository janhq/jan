#!/usr/bin/env bash
# The one place a build's version is written into the source tree.
#
#   stamp-version.sh VERSION   write VERSION into every manifest a release
#                              build reads it from, then verify the result
#   stamp-version.sh --check   fail if the committed manifests the app and the
#                              `jan` CLI report their version from disagree,
#                              or are older than the latest release tag
#
# Every desktop build template calls this instead of carrying its own list.
#
# A release stamp only lives in that build's workspace and is never committed,
# so a `jan` built from a v0.8.6+ tag or release branch reported the last
# committed version, 0.8.5 (janhq/jan-internal#454). --check keeps the
# committed manifests in step with each other and with the latest release;
# bumping them is still a commit (see `chore(release): bump app version to
# 0.8.5`).
#
# Stamping needs jq and ctoml; --check needs only jq and git, so a plain runner
# can guard the committed tree.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# `jan --version` falls back to env!("CARGO_PKG_VERSION") inside app_lib, which
# is src-tauri/Cargo.toml's version, not jan-cli's; the CLI crate's own version
# only reaches Cargo.lock and `cargo install`. Both, plus the desktop's
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
# A Windows runner checks out with core.autocrlf, so a trailing CR would make
# `[package]` and every version comparison miss; both readers drop it.
toml_version() {
  awk '{ sub(/\r$/, "") }
       /^\[/ { pkg = ($0 == "[package]") }
       pkg && /^version[ \t]*=/ { sub(/^[^"]*"/, ""); sub(/".*/, ""); print; exit }' "$1"
}

# jq.exe writes text mode, so its own output can end in CRLF.
json_version() {
  jq -r '.version' "$1" | tr -d '\r'
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

# Agreeing manifests can still all lag: v0.8.6 to v0.8.8 shipped with every one
# at 0.8.5. Compare with the newest vX.Y.Z tag on origin; ls-remote needs no
# history, so a shallow CI checkout works. A pre-release bump (main ahead of
# the last tag) passes.
check_released() {
  local have="$1" tags latest
  if ! tags="$(git ls-remote --tags --refs origin 'refs/tags/v*')"; then
    echo "::error title=version check::could not list origin's tags to compare against the latest release"
    return 1
  fi
  latest="$(printf '%s\n' "$tags" |
    sed -n 's#.*refs/tags/v\([0-9]*\.[0-9]*\.[0-9]*\)$#\1#p' | sort -V | tail -n 1)"
  if [ -z "$latest" ]; then
    echo "::warning title=version check::no vX.Y.Z tag on origin; skipped the release comparison"
    return 0
  fi
  echo "latest release tag: v$latest"
  if [ "$(printf '%s\n%s\n' "$latest" "$have" | sort -V | head -n 1)" != "$latest" ]; then
    echo "::error title=version behind release::committed version $have is older than v$latest; bump the manifests (or run .github/scripts/stamp-version.sh $latest)"
    return 1
  fi
}

stamp() {
  # A CR in the argument would be written into every manifest.
  local version="${1//$'\r'/}" f tmp
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
  --check) check && check_released "$(toml_version src-tauri/Cargo.toml)" ;;
  ""|-*) echo "usage: $0 VERSION | --check" >&2; exit 2 ;;
  *) stamp "$1" ;;
esac
