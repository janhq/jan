#!/usr/bin/env bash
# Runs Rust test coverage using cargo-llvm-cov across all workspace crates.
# Outputs: rust-lcov.info in the current directory.
set -euo pipefail

cargo llvm-cov clean --workspace --manifest-path src-tauri/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
cargo llvm-cov --no-report --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml
cargo llvm-cov --no-report --manifest-path src-tauri/utils/Cargo.toml
cargo llvm-cov report --lcov --output-path rust-lcov.info --manifest-path src-tauri/Cargo.toml
