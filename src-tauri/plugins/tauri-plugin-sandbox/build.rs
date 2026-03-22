use std::path::{Path, PathBuf};
use std::process::Command;

const COMMANDS: &[&str] = &[];

const WASM_TARGET: &str = "wasm32-wasip1";

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let wasm_out     = manifest_dir.join("wasm");

    println!("cargo:rerun-if-changed=runner/src");
    println!("cargo:rerun-if-changed=wasm-worker/src");

    std::fs::create_dir_all(&wasm_out).expect("failed to create wasm/ output directory");

    build_runner(&manifest_dir, &wasm_out);
    build_wasm_worker(&manifest_dir);
}

/// Build js-runner.wasm (the QuickJS engine compiled to WASI).
fn build_runner(manifest_dir: &Path, wasm_out: &Path) {
    let status = Command::new("cargo")
        .args(["build", "--release", "--target", WASM_TARGET])
        .current_dir(manifest_dir.join("runner"))
        .status()
        .expect("cargo build runner failed");

    assert!(status.success(), "runner WASM build failed");

    let src = manifest_dir
        .join("runner/target")
        .join(WASM_TARGET)
        .join("release/js-runner.wasm");

    std::fs::copy(&src, wasm_out.join("js-runner.wasm"))
        .unwrap_or_else(|e| panic!("copy js-runner.wasm: {e}"));
}

/// Build jan-wasm-worker (standalone native binary with wasmtime).
///
/// Like `runner/`, this is a fully independent crate with its own Cargo.toml
/// and target directory — no workspace lock conflicts.
fn build_wasm_worker(manifest_dir: &Path) {
    let worker_dir = manifest_dir.join("wasm-worker");

    let profile = if std::env::var("PROFILE").as_deref() == Ok("release") {
        "release"
    } else {
        "dev"
    };

    let mut args = vec!["build".to_string()];
    if profile == "release" {
        args.push("--release".to_string());
    }

    let status = Command::new("cargo")
        .args(&args)
        .current_dir(&worker_dir)
        .status()
        .expect("cargo build wasm-worker failed");

    assert!(status.success(), "jan-wasm-worker build failed");

    // Copy the worker binary next to the main crate's output.
    // OUT_DIR is like: <workspace-target>/<profile>/build/<pkg>-<hash>/out
    // Walk up 3 levels to reach <workspace-target>/<profile>/
    let profile_dir = if profile == "release" { "release" } else { "debug" };
    let worker_bin = worker_dir
        .join("target")
        .join(profile_dir)
        .join("jan-wasm-worker");

    if let Ok(out_dir) = std::env::var("OUT_DIR") {
        let out_path = PathBuf::from(&out_dir);
        if let Some(target_profile) = out_path
            .parent()                // <pkg>-<hash>
            .and_then(|p| p.parent()) // build
            .and_then(|p| p.parent()) // <profile>
        {
            let dest = target_profile.join("jan-wasm-worker");
            if let Err(e) = std::fs::copy(&worker_bin, &dest) {
                eprintln!(
                    "warning: failed to copy jan-wasm-worker to {}: {e}",
                    dest.display()
                );
            }
        }
    }
}
