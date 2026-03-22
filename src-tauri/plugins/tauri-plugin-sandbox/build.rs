use std::path::PathBuf;
use std::process::Command;

const COMMANDS: &[&str] = &[];

const TARGET: &str = "wasm32-wasip1";

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let wasm_out     = manifest_dir.join("wasm");

    println!("cargo:rerun-if-changed=runner/src");
    println!("cargo:rerun-if-changed=src/bin/jan-wasm-worker.rs");
    println!("cargo:rerun-if-changed=src/wasm_runtime.rs");

    std::fs::create_dir_all(&wasm_out).expect("failed to create wasm/ output directory");

    build_runner(&manifest_dir, &wasm_out);
    build_wasm_worker(&manifest_dir);
}

fn build_runner(manifest_dir: &PathBuf, wasm_out: &PathBuf) {
    let status = Command::new("cargo")
        .args(["build", "--release", "--target", TARGET])
        .current_dir(manifest_dir.join("runner"))
        .status()
        .expect("cargo build runner failed");

    assert!(status.success(), "runner WASM build failed");

    let src = manifest_dir
        .join("runner/target")
        .join(TARGET)
        .join("release/js-runner.wasm");

    std::fs::copy(&src, wasm_out.join("js-runner.wasm"))
        .unwrap_or_else(|e| panic!("copy js-runner.wasm: {e}"));
}

/// Build the jan-wasm-worker binary (with wasmtime-runtime feature) and copy
/// it next to the main crate's output so `find_wasm_worker()` can find it.
fn build_wasm_worker(manifest_dir: &PathBuf) {
    let profile = if std::env::var("PROFILE").as_deref() == Ok("release") {
        "release"
    } else {
        "dev"
    };

    // Build the worker binary from this crate with wasmtime-runtime enabled.
    // We use --manifest-path and a separate target dir to avoid deadlocking
    // with the outer cargo build that is compiling this crate as a library.
    let worker_target = manifest_dir.join("target-worker");

    let mut cmd = Command::new("cargo");
    cmd.args([
        "build",
        "--manifest-path",
        manifest_dir.join("Cargo.toml").to_str().unwrap(),
        "--features", "wasmtime-runtime",
        "--bin", "jan-wasm-worker",
        "--profile", profile,
        "--target-dir",
        worker_target.to_str().unwrap(),
    ]);

    let status = cmd.status().expect("cargo build jan-wasm-worker failed");
    assert!(status.success(), "jan-wasm-worker build failed");

    // Copy the worker binary next to the main crate's output directory.
    let profile_dir = if profile == "release" { "release" } else { "debug" };
    let worker_bin = worker_target.join(profile_dir).join("jan-wasm-worker");

    // OUT_DIR is something like .../target/debug/build/<pkg>-<hash>/out
    // Walk up to the target profile dir to place the binary alongside other bins.
    if let Ok(out_dir) = std::env::var("OUT_DIR") {
        let out_path = PathBuf::from(&out_dir);
        // out_dir: <target>/<profile>/build/<pkg>/out → go up 3 levels to <target>/<profile>
        if let Some(target_profile) = out_path.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
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
