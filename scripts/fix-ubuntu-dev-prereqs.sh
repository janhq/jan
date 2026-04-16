#!/usr/bin/env bash
# Jan dev prerequisites on Ubuntu:
# - Node 20+ (core build uses import attributes in rolldown.config.mjs)
# - Yarn 4 via Corepack
# - Rust via rustup (Tauri) — non-interactive, minimal profile (smaller disk use)
#
# Env: JAN_SKIP_APT=1  skip sudo apt steps
#      JAN_SKIP_RUST=1  skip Rust (fail if cargo missing)
#      JAN_NODE_VERSION=20.19.5  override Node tarball version
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "Run as your normal user; the script uses sudo only for apt." >&2
  exit 1
fi

need_mib_free() {
  local path="$1"
  local min_mib="${2:-400}"
  local avail_kb
  avail_kb="$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print int($4)}')" || avail_kb=0
  if [[ "$avail_kb" -lt $((min_mib * 1024)) ]]; then
    echo "ERROR: Need at least ~${min_mib} MiB free on the filesystem containing ${path}." >&2
    echo "  Now: $((avail_kb / 1024)) MiB free. Try: sudo apt clean, rm -rf ~/.cache/*, enlarge VM disk." >&2
    return 1
  fi
  return 0
}

if [[ "${JAN_SKIP_APT:-}" != "1" ]]; then
  LEGACY_CHROME_LIST="/etc/apt/sources.list.d/google-chrome.list"
  if [[ -f "$LEGACY_CHROME_LIST" ]]; then
    echo "Disabling legacy ${LEGACY_CHROME_LIST} (breaks apt with NO_PUBKEY)."
    sudo mv "$LEGACY_CHROME_LIST" "${LEGACY_CHROME_LIST}.disabled"
  fi
  echo "Running apt-get update..."
  sudo apt-get update
else
  echo "Skipping apt (JAN_SKIP_APT=1)."
fi

NODE_MIN_MAJOR=20
node_major() {
  node -p "Number(process.versions.node.split('.')[0] || 0)" 2>/dev/null || echo 0
}

install_official_node20() {
  local ver="${JAN_NODE_VERSION:-20.19.5}"
  local arch NODE_ARCH opt name prefix tmp url
  arch="$(uname -m)"
  case "$arch" in
    x86_64) NODE_ARCH=x64 ;;
    aarch64) NODE_ARCH=arm64 ;;
    *)
      echo "Unsupported CPU arch: $arch" >&2
      exit 1
      ;;
  esac

  opt="${HOME}/.local/opt"
  name="node-v${ver}-linux-${NODE_ARCH}"
  prefix="${opt}/${name}"
  mkdir -p "${opt}"

  if [[ ! -x "${prefix}/bin/node" ]]; then
    need_mib_free "$HOME" 300 || exit 1
    echo "Installing Node ${ver} (${NODE_ARCH}) under ${prefix} ..."
    url="https://nodejs.org/dist/v${ver}/${name}.tar.xz"
    tmp="$(mktemp)"
    curl -fsSL "${url}" -o "${tmp}"
    tar -xJf "${tmp}" -C "${opt}"
    rm -f "${tmp}"
  fi

  export PATH="${prefix}/bin:${PATH}"
  hash -r 2>/dev/null || true
}

if ! command -v node >/dev/null 2>&1 || [[ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]]; then
  echo "Jan needs Node.js ${NODE_MIN_MAJOR}+ (you have: $(node -v 2>/dev/null || echo 'none'))."
  install_official_node20
fi

if [[ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]]; then
  echo "Still on Node $(node -v); cannot continue." >&2
  exit 1
fi

echo "Using $(node -v) at $(command -v node)"

corepack enable
corepack prepare yarn@4.5.3 --activate

hash -r 2>/dev/null || true
yarn --version

if [[ "${JAN_SKIP_RUST:-}" == "1" ]]; then
  echo "Skipping Rust (JAN_SKIP_RUST=1)."
else
  if ! command -v cargo >/dev/null 2>&1 || ! cargo -V &>/dev/null; then
    need_mib_free "$HOME" 500 || exit 1
    echo "Installing Rust (minimal profile, non-interactive) — do not run rustup interactively; use this script or repair-rust-toolchain.sh."
    # -y: no prompts. --profile minimal: omits rust-docs (~20MB+) and speeds unpack on small disks.
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
      --default-toolchain stable \
      --profile minimal
    # shellcheck source=/dev/null
    source "${HOME}/.cargo/env"
  fi

  if command -v cargo >/dev/null 2>&1 && ! cargo -V &>/dev/null; then
    echo "cargo is broken (partial rustup install). Run: ./scripts/repair-rust-toolchain.sh" >&2
    exit 1
  fi
fi

echo
echo "Prereqs OK."
NODE_BIN_DIR="$(dirname "$(command -v node)")"
echo "Optional — put Node first on PATH in new shells:"
echo "  export PATH=\"${NODE_BIN_DIR}:\$PATH\""
echo "Rust — new shells need:"
echo "  source \"\$HOME/.cargo/env\""
echo "Then: cd ~/jan && make dev"
