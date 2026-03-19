use std::path::PathBuf;
use std::process::Command;

const COMMANDS: &[&str] = &[
    "agent_run",
    "agent_reset",
    "get_tool_manifest",
];

const TARGET: &str = "wasm32-wasip1";

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let wasm_out     = manifest_dir.join("wasm");

    println!("cargo:rerun-if-changed=tools-src/web-search/src");
    println!("cargo:rerun-if-changed=tools-src/http-fetch/src");
    println!("cargo:rerun-if-changed=tools-src/code-exec/src");

    std::fs::create_dir_all(&wasm_out).expect("failed to create wasm/ output directory");

    build_tools(&manifest_dir, &wasm_out);
}

fn build_tools(manifest_dir: &PathBuf, wasm_out: &PathBuf) {
    let status = Command::new("cargo")
        .args(["build", "--release", "--target", TARGET])
        .current_dir(manifest_dir.join("tools-src"))
        .status()
        .expect("cargo build tools-src failed");

    assert!(status.success(), "tools WASM build failed");

    let release = manifest_dir
        .join("tools-src/target")
        .join(TARGET)
        .join("release");

    let copies: &[(&str, &str)] = &[
        ("web_search_tool.wasm", "tools/web/search.wasm"),
        ("http_fetch_tool.wasm", "tools/http/fetch.wasm"),
        ("code_exec_tool.wasm",  "tools/code/exec.wasm"),
    ];

    for (src_name, dest_rel) in copies {
        let dest = wasm_out.join(dest_rel);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::copy(release.join(src_name), &dest)
            .unwrap_or_else(|e| panic!("copy {src_name}: {e}"));
    }
}
