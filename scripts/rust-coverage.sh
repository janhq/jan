#!/usr/bin/env bash
# Runs Rust test coverage using cargo-llvm-cov across all workspace crates.
# Outputs: rust-lcov.info in the current directory.
set -euo pipefail

# Tauri build script validates resources, externalBin, and icons exist.
# Create stubs so the build succeeds in CI where these aren't present.
TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
mkdir -p src-tauri/resources/bin src-tauri/resources/pre-install src-tauri/icons
[ -f src-tauri/resources/LICENSE ] || touch src-tauri/resources/LICENSE
[ -f src-tauri/resources/bin/jan-cli ] || touch src-tauri/resources/bin/jan-cli
[ "$(ls -A src-tauri/resources/pre-install 2>/dev/null)" ] || touch src-tauri/resources/pre-install/.gitkeep
for bin in uv bun; do
  stub="src-tauri/resources/bin/${bin}-${TRIPLE}"
  [ -f "$stub" ] || touch "$stub"
done
# Icons are gitignored; generate_context!() requires them at compile time
for icon in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  [ -f "src-tauri/icons/$icon" ] || cp src-tauri/icons/icon.png "src-tauri/icons/$icon"
done

cargo llvm-cov clean --workspace --manifest-path src-tauri/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
cargo llvm-cov --no-report --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/utils/Cargo.toml
cargo llvm-cov report --lcov --output-path rust-lcov.info --manifest-path src-tauri/Cargo.toml
