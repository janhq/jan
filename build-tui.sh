#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────────────────
# build-tui.sh — Build the Jan Agent CLI TUI binary and
#                install it to ~/.local/bin.
#
# Usage:
#   ./build-tui.sh               # debug build + install
#   ./build-tui.sh --release     # release build + install
#   ./build-tui.sh check         # cargo check only (no binary)
#   ./build-tui.sh test          # run TUI tests
#   ./build-tui.sh help          # this help
# ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/src-tauri"        # the app_lib library crate (check/test)
CLI_DIR="$SCRIPT_DIR/src-tauri/jan-cli" # the standalone `jan` CLI crate (build)
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="jan"

# Ensure install dir exists
mkdir -p "$INSTALL_DIR"

build() {
    local profile=$1  # "debug" or "release"
    local flag=""
    local target_dir="debug"

    if [ "$profile" = "release" ]; then
        flag="--release"
        target_dir="release"
    fi

    echo "==> Building CLI binary (${profile})..."
    (cd "$CLI_DIR" && cargo build $flag --features cli)

    # jan-cli's .cargo/config.toml redirects output into the app's target dir.
    local artifact="$APP_DIR/target/$target_dir/jan"
    if [ ! -f "$artifact" ]; then
        echo "ERROR: build artifact not found at $artifact"
        exit 1
    fi

    echo "==> Installing to $INSTALL_DIR/$BIN_NAME ..."
    cp "$artifact" "$INSTALL_DIR/$BIN_NAME"
    chmod +x "$INSTALL_DIR/$BIN_NAME"

    echo "==> Done: $INSTALL_DIR/$BIN_NAME"
    echo "    Make sure $INSTALL_DIR is in your PATH."
}

case "${1:-debug}" in
    check)
        echo "==> cargo check (no binary produced)..."
        (cd "$APP_DIR" && cargo check --no-default-features --features cli --lib)
        echo "==> OK"
        ;;
    test)
        echo "==> Running TUI tests..."
        (cd "$APP_DIR" && cargo test --no-default-features --features cli --lib -- core::cli::tui)
        echo "==> All TUI tests passed"
        ;;
    release)
        build release
        ;;
    debug|"")
        build debug
        ;;
    help|--help|-h)
        echo "Usage: $0 [check|test|debug|release|help]"
        echo ""
        echo "  check   — cargo check (fast, no binary)"
        echo "  test    — run TUI unit tests"
        echo "  debug   — debug build + install (default)"
        echo "  release — release build + install"
        echo "  help    — this message"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Usage: $0 [check|test|debug|release|help]"
        exit 1
        ;;
esac
