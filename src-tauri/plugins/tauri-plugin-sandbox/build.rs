use std::path::PathBuf;
use std::process::Command;

const COMMANDS: &[&str] = &[];

const TARGET: &str = "wasm32-wasip1";

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let wasm_out     = manifest_dir.join("wasm");

    println!("cargo:rerun-if-changed=runner/src");

    std::fs::create_dir_all(&wasm_out).expect("failed to create wasm/ output directory");

    build_runner(&manifest_dir, &wasm_out);
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

