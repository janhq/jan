#!/usr/bin/env bash
# Installs the `jan` agent CLI on Linux and macOS: either a published build
# from delta.jan.ai (default) or one compiled from this checkout (--source).
# Windows has install-jan-agent.ps1; this script also works from Git Bash,
# but only if `unzip` is available there.
# Downloaded builds self-update via `jan update`; --source builds do not,
# because the update channel is embedded only by the nightly CI.
set -euo pipefail

CHANNEL="agent-nightly"
INSTALL_DIR="${JAN_INSTALL_DIR:-$HOME/.local/bin}"
VERSION=""
FROM_SOURCE=0
TMP_DIR=""
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: scripts/install-jan-agent.sh [options]

  --dir DIR         Install directory (default: $JAN_INSTALL_DIR or ~/.local/bin)
  --channel NAME    Release channel to install from (default: agent-nightly)
  --version VER     Install a specific version instead of the latest
  --source          Build from this checkout instead of downloading
  -h, --help        Show this help

Examples:
  scripts/install-jan-agent.sh                      # latest nightly to ~/.local/bin
  scripts/install-jan-agent.sh --dir /usr/local/bin # needs write access to that dir
  scripts/install-jan-agent.sh --version 0.8.4-97   # a specific nightly
  scripts/install-jan-agent.sh --source             # compile this working tree
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:?--dir needs a path}"; shift 2 ;;
    --channel) CHANNEL="${2:?--channel needs a name}"; shift 2 ;;
    --version) VERSION="${2:?--version needs a version}"; shift 2 ;;
    --source) FROM_SOURCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

# Platform keys and archive names match the nightly workflow's manifest and the
# self-updater in src-tauri/src/core/cli/updater.rs.
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux)
      case "$arch" in
        x86_64)
          PLATFORM_KEY="linux-x86_64"
          ARCHIVE_SLUG="linux-x86_64"
          ;;
        aarch64)
          PLATFORM_KEY="linux-aarch64"
          ARCHIVE_SLUG="linux-aarch64"
          ;;
        *) die "no published build for Linux $arch; use --source" ;;
      esac
      ARCHIVE_EXT="tar.gz"
      ;;
    Darwin)
      PLATFORM_KEY="darwin-universal"
      ARCHIVE_SLUG="darwin-universal"
      ARCHIVE_EXT="tar.gz"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM_KEY="windows-x86_64"
      ARCHIVE_SLUG="windows-x86_64"
      ARCHIVE_EXT="zip"
      BINARY_NAME="jan.exe"
      ;;
    *) die "unsupported platform: $os $arch" ;;
  esac
  BINARY_NAME="${BINARY_NAME:-jan}"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo ""
  fi
}

# The manifest's per-platform objects are flat (url, sha256), so collapsing
# whitespace and slicing out the one object is enough -- no jq dependency.
# Absent fields (sha256 is optional) print nothing rather than failing.
manifest_field() {
  local manifest="$1" key="$2" field="$3"
  printf '%s' "$manifest" \
    | tr -d ' \n\r\t' \
    | grep -o "\"$key\":{[^}]*}" \
    | grep -o "\"$field\":\"[^\"]*\"" \
    | head -1 \
    | sed 's/.*:"//; s/"$//' || true
}

manifest_version() {
  printf '%s' "$1" \
    | tr -d ' \n\r\t' \
    | grep -o '"version":"[^"]*"' \
    | head -1 \
    | sed 's/.*:"//; s/"$//' || true
}

install_binary() {
  local src="$1" dest="$INSTALL_DIR/$BINARY_NAME"
  mkdir -p "$INSTALL_DIR" || die "cannot create $INSTALL_DIR"
  [ -w "$INSTALL_DIR" ] || die "$INSTALL_DIR is not writable; pick another --dir or fix permissions"
  # Replacing a running binary fails on some systems; remove it first.
  rm -f "$dest"
  install -m 755 "$src" "$dest"
  # `jan --version` reports Cargo.toml's pinned version, not the nightly build
  # number, so report the build we actually installed.
  if [ -n "$VERSION" ]; then
    echo "installed $dest ($CHANNEL $VERSION)"
  else
    echo "installed $dest"
  fi
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "note: $INSTALL_DIR is not on your PATH; add it to your shell profile" ;;
  esac
}

build_from_source() {
  command -v cargo >/dev/null 2>&1 || die "cargo not found; install Rust first"
  echo "building the CLI from $REPO_ROOT (release)"
  # The CLI and the desktop app are mutually exclusive feature configs, so the
  # default features must stay off.
  (cd "$REPO_ROOT/src-tauri" && cargo build --no-default-features --features cli --bin jan --release)
  local built="$REPO_ROOT/src-tauri/target/release/$BINARY_NAME"
  [ -f "$built" ] || die "expected a binary at $built"
  install_binary "$built"
  echo "note: builds from source have no update channel embedded, so \`jan update\` is a no-op"
}

install_published() {
  command -v curl >/dev/null 2>&1 || die "curl not found"
  local base="https://delta.jan.ai/$CHANNEL" url="" expected=""

  if [ -n "$VERSION" ]; then
    url="$base/jan-agent-$ARCHIVE_SLUG-$VERSION.$ARCHIVE_EXT"
  else
    echo "resolving the latest $CHANNEL build"
    local manifest
    manifest="$(curl -fsSL "$base/manifest.json")" || die "cannot fetch $base/manifest.json"
    VERSION="$(manifest_version "$manifest")"
    url="$(manifest_field "$manifest" "$PLATFORM_KEY" url)"
    expected="$(manifest_field "$manifest" "$PLATFORM_KEY" sha256)"
    [ -n "$url" ] || die "the $CHANNEL manifest has no build for $PLATFORM_KEY"
  fi

  # TMP_DIR is global: the EXIT trap fires outside this function's scope.
  # BSD mktemp (macOS) needs an explicit template, unlike GNU's bare -d.
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jan-agent.XXXXXX")"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT

  local tmp="$TMP_DIR"
  local archive="$tmp/jan-agent.$ARCHIVE_EXT"
  echo "downloading ${VERSION:-$CHANNEL} from $url"
  curl -fSL --progress-bar -o "$archive" "$url" || die "download failed: $url"

  if [ -n "$expected" ]; then
    local actual
    actual="$(sha256_of "$archive")"
    if [ -z "$actual" ]; then
      echo "warning: no sha256 tool found; skipping checksum verification" >&2
    elif [ "$actual" != "$expected" ]; then
      die "checksum mismatch: expected $expected, got $actual"
    else
      echo "sha256 verified"
    fi
  fi

  if [ "$ARCHIVE_EXT" = "zip" ]; then
    command -v unzip >/dev/null 2>&1 || die "unzip not found; on Windows use scripts/install-jan-agent.ps1"
    unzip -qo "$archive" -d "$tmp"
  else
    tar xzf "$archive" -C "$tmp"
  fi

  # Published archives keep the binary at the root, but tar and 7z package it
  # differently, so search by name rather than assuming a layout.
  # `head -1` rather than find's -quit, which is not in POSIX; the `|| true`
  # absorbs the SIGPIPE status that pipefail would otherwise treat as fatal.
  local extracted
  extracted="$(find "$tmp" -type f -name "$BINARY_NAME" | head -1 || true)"
  [ -n "$extracted" ] || die "no $BINARY_NAME inside the archive"
  chmod +x "$extracted"
  install_binary "$extracted"
}

detect_platform
if [ "$FROM_SOURCE" = 1 ]; then
  build_from_source
else
  install_published
fi
