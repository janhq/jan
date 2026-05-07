//! Out-of-process shared-library dependency analyzer. `lddtree`/`goblin` can
//! panic or segfault on malformed binaries; running it in a subprocess keeps
//! a crash from taking down the app.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const ANALYZE_FLAG: &str = "--internal-analyze-deps";

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AnalyzeOutput {
    pub missing: Vec<String>,
    pub resolved: Vec<String>,
}

pub fn run_deps_analyzer_if_requested() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(ANALYZE_FLAG) {
        return;
    }

    let lib_dir = match args.next() {
        Some(d) => PathBuf::from(d),
        None => {
            eprintln!("{}: missing <lib_dir> argument", ANALYZE_FLAG);
            std::process::exit(2);
        }
    };
    let targets: Vec<PathBuf> = args.map(PathBuf::from).collect();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        analyze(&lib_dir, &targets)
    }));

    match result {
        Ok(out) => match serde_json::to_string(&out) {
            Ok(s) => {
                println!("{}", s);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("serialize failed: {}", e);
                std::process::exit(3);
            }
        },
        Err(e) => {
            let msg = e
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| e.downcast_ref::<String>().map(|s| s.as_str()))
                .unwrap_or("unknown panic");
            eprintln!("lddtree panic: {}", msg);
            std::process::exit(4);
        }
    }
}

fn analyze(lib_dir: &Path, targets: &[PathBuf]) -> AnalyzeOutput {
    let analyzer =
        lddtree::DependencyAnalyzer::default().add_library_path(lib_dir.to_path_buf());

    let mut missing: HashSet<String> = HashSet::new();
    let mut resolved: HashSet<String> = HashSet::new();

    for path in targets {
        let tree = match analyzer.clone().analyze(path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for (name, lib) in &tree.libraries {
            if lib.found() {
                resolved.insert(name.clone());
            } else if !is_virtual_windows_dll(name) {
                missing.insert(name.clone());
            }
        }
    }

    let mut missing: Vec<String> = missing.into_iter().collect();
    let mut resolved: Vec<String> = resolved.into_iter().collect();
    missing.sort();
    resolved.sort();
    AnalyzeOutput { missing, resolved }
}

// api-ms-win-*/ext-ms-win-* are virtual DLLs resolved by the Windows kernel
// and never exist on disk — lddtree flags them as missing but they aren't.
pub(crate) fn is_virtual_windows_dll(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("api-ms-win-") || lower.starts_with("ext-ms-win-")
}

pub fn analyze_out_of_process(lib_dir: &Path, targets: &[PathBuf]) -> AnalyzeOutput {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("deps_analyzer: current_exe failed: {}", e);
            return AnalyzeOutput::default();
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.arg(ANALYZE_FLAG).arg(lib_dir);
    for t in targets {
        cmd.arg(t);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("deps_analyzer: failed to spawn subprocess: {}", e);
            return AnalyzeOutput::default();
        }
    };

    if !output.status.success() {
        log::warn!(
            "deps_analyzer: subprocess exited with {:?}; stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim(),
        );
        return AnalyzeOutput::default();
    }

    match serde_json::from_slice::<AnalyzeOutput>(&output.stdout) {
        Ok(o) => o,
        Err(e) => {
            log::warn!(
                "deps_analyzer: malformed subprocess output: {} (stdout: {})",
                e,
                String::from_utf8_lossy(&output.stdout).trim(),
            );
            AnalyzeOutput::default()
        }
    }
}
