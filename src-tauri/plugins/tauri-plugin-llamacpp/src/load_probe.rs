//! Out-of-process `dlopen` probe for a backend's GPU library.
//!
//! In a release build, ggml discards the loader error when a backend library
//! fails to load (`ggml_backend_load_all_from_path` passes `silent = true`
//! under `NDEBUG`), so llama-server registers only the CPU backend and runs
//! normally. No stderr is produced and the process exits 0, which makes the
//! failure invisible to output parsing.
//!
//! Loading the library ourselves recovers the real reason. Static ELF analysis
//! is not equivalent: without the runtime search path it reports libraries that
//! sit beside the binary as missing. The probe therefore runs with the same
//! environment the router child gets, and in a subprocess, because initializing
//! a GPU runtime in-process can abort.

use crate::error::extract_missing_libraries;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const PROBE_FLAG: &str = "--internal-probe-load";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LoadProbeResult {
    /// Libraries that loaded cleanly.
    pub loaded: Vec<String>,
    /// One entry per library that failed to load.
    pub failures: Vec<LoadProbeFailure>,
    /// True when the probe could not run at all, so an empty `failures` list
    /// must not be read as success.
    pub inconclusive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LoadProbeFailure {
    pub library: String,
    /// Raw loader message.
    pub error: String,
    /// Names parsed out of `error`, for install advice.
    pub missing_libraries: Vec<String>,
}

/// Backend-id substring -> the ggml library that implements it. Metal is
/// omitted: it is part of the platform on Apple Silicon and is not a separately
/// loadable failure mode.
const GPU_LIBRARY_KEYWORDS: [(&str, &str); 3] =
    [("cuda", "cuda"), ("vulkan", "vulkan"), ("hip", "hip")];

fn library_extension() -> &'static str {
    if cfg!(target_os = "windows") {
        "dll"
    } else if cfg!(target_os = "macos") {
        "dylib"
    } else {
        "so"
    }
}

fn library_prefix() -> &'static str {
    if cfg!(target_os = "windows") {
        "ggml-"
    } else {
        "libggml-"
    }
}

/// The ggml GPU library filenames to probe for a backend id, matching ggml's own
/// `[lib]ggml-<name>*.<ext>` naming.
pub fn gpu_library_candidates(backend: &str, entries: &[String]) -> Vec<String> {
    let lower = backend.to_lowercase();
    let keyword = GPU_LIBRARY_KEYWORDS
        .iter()
        .find(|(marker, _)| lower.contains(marker))
        .map(|(_, lib)| *lib);

    let Some(keyword) = keyword else {
        return Vec::new();
    };

    let stem = format!("{}{}", library_prefix(), keyword);
    let ext = library_extension();
    let mut matches: Vec<String> = entries
        .iter()
        .filter(|name| {
            let lower_name = name.to_lowercase();
            lower_name.starts_with(&stem) && lower_name.ends_with(&format!(".{ext}"))
        })
        .cloned()
        .collect();
    matches.sort();
    matches
}

/// Child-side entry point. Returns without doing anything unless invoked with
/// `PROBE_FLAG`, so it is safe to call unconditionally at startup.
pub fn run_load_probe_if_requested() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(PROBE_FLAG) {
        return;
    }

    let targets: Vec<PathBuf> = args.map(PathBuf::from).collect();
    let result = probe_libraries(&targets);

    match serde_json::to_string(&result) {
        Ok(s) => {
            println!("{}", s);
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("serialize failed: {}", e);
            std::process::exit(3);
        }
    }
}

fn probe_libraries(targets: &[PathBuf]) -> LoadProbeResult {
    let mut result = LoadProbeResult::default();

    for target in targets {
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| target.to_string_lossy().to_string());

        // Safety: loading a library runs its initializers. This is why the probe
        // is confined to a subprocess.
        match unsafe { libloading::Library::new(target) } {
            Ok(lib) => {
                // Leak deliberately: unloading a GPU runtime mid-teardown has
                // its own crash modes, and this process exits immediately.
                std::mem::forget(lib);
                result.loaded.push(name);
            }
            Err(e) => {
                let error = e.to_string();
                result.failures.push(LoadProbeFailure {
                    library: name,
                    missing_libraries: extract_missing_libraries(&error),
                    error,
                });
            }
        }
    }

    result
}

/// Parent-side entry point. Spawns this executable with `PROBE_FLAG` and the
/// same library search path the router child receives.
pub fn probe_out_of_process(
    bin_dir: Option<&Path>,
    cuda: &jan_utils::CudaPaths,
    targets: &[PathBuf],
) -> LoadProbeResult {
    let inconclusive = LoadProbeResult {
        inconclusive: true,
        ..Default::default()
    };

    if targets.is_empty() {
        return LoadProbeResult::default();
    }

    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("load_probe: current_exe failed: {}", e);
            return inconclusive;
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.arg(PROBE_FLAG);
    for target in targets {
        cmd.arg(target);
    }

    // Parity with the router child: the same search path, or the probe would
    // report libraries the real process resolves. This is the whole reason a
    // static ELF scan is not a substitute.
    let env = jan_utils::library_path_env(bin_dir, cuda);
    for (key, value) in &env.vars {
        cmd.env(key, value);
    }
    if let Some(dir) = &env.current_dir {
        cmd.current_dir(dir);
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("load_probe: failed to spawn subprocess: {}", e);
            return inconclusive;
        }
    };

    if !output.status.success() {
        log::warn!(
            "load_probe: subprocess exited with {:?}; stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim(),
        );
        return inconclusive;
    }

    match serde_json::from_slice::<LoadProbeResult>(&output.stdout) {
        Ok(o) => o,
        Err(e) => {
            log::warn!(
                "load_probe: malformed subprocess output: {} (stdout: {})",
                e,
                String::from_utf8_lossy(&output.stdout).trim(),
            );
            inconclusive
        }
    }
}

/// Loads the backend's GPU library the way llama-server would, reporting the
/// reason it cannot. Returns a clean result for CPU-only and macOS backends,
/// which have no separately loadable GPU library.
#[tauri::command]
pub async fn probe_backend_load(
    backend: String,
    version: String,
    jan_data_folder: String,
    is_windows: bool,
) -> Result<LoadProbeResult, crate::error::LlamacppError> {
    let exe_path = PathBuf::from(crate::backend::get_backend_exe_path(
        backend.clone(),
        version,
        jan_data_folder,
        is_windows,
    ));
    let Some(bin_dir) = exe_path.parent().map(PathBuf::from) else {
        return Ok(LoadProbeResult {
            inconclusive: true,
            ..Default::default()
        });
    };

    let entries: Vec<String> = match std::fs::read_dir(&bin_dir) {
        Ok(dir) => dir
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(e) => {
            log::warn!("load_probe: cannot read {}: {}", bin_dir.display(), e);
            return Ok(LoadProbeResult {
                inconclusive: true,
                ..Default::default()
            });
        }
    };

    let targets: Vec<PathBuf> = gpu_library_candidates(&backend, &entries)
        .into_iter()
        .map(|name| bin_dir.join(name))
        .collect();
    if targets.is_empty() {
        return Ok(LoadProbeResult::default());
    }

    // Spawning and waiting on a subprocess would otherwise block a runtime worker.
    tokio::task::spawn_blocking(move || {
        let cuda = jan_utils::find_cuda_paths().merged(jan_utils::find_rocm_paths());
        probe_out_of_process(Some(&bin_dir), &cuda, &targets)
    })
    .await
    .map_err(|e| {
        crate::error::LlamacppError::new(
            crate::error::ErrorCode::InternalError,
            "Backend load probe failed to run.".into(),
            Some(e.to_string()),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries() -> Vec<String> {
        vec![
            "libggml-base.so".to_string(),
            "libggml-base.so.0".to_string(),
            "libggml-cpu-haswell.so".to_string(),
            "libggml-cuda.so".to_string(),
            "libggml-vulkan.so".to_string(),
            "llama-server".to_string(),
        ]
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn picks_the_cuda_library_for_a_cuda_backend() {
        assert_eq!(
            gpu_library_candidates("linux-cuda-12-common_cpus-x64", &entries()),
            vec!["libggml-cuda.so".to_string()]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn picks_the_vulkan_library_for_a_vulkan_backend() {
        assert_eq!(
            gpu_library_candidates("linux-vulkan-common_cpus-x64", &entries()),
            vec!["libggml-vulkan.so".to_string()]
        );
    }

    // CPU and base libraries are not the GPU failure mode and must not be
    // probed, or a CPU-only install would look like a GPU problem.
    #[cfg(target_os = "linux")]
    #[test]
    fn never_selects_cpu_or_base_libraries() {
        for backend in ["linux-cuda-12-common_cpus-x64", "linux-vulkan-common_cpus-x64"] {
            let picked = gpu_library_candidates(backend, &entries());
            assert!(
                !picked.iter().any(|p| p.contains("cpu") || p.contains("base")),
                "{picked:?}"
            );
        }
    }

    #[test]
    fn probes_nothing_for_a_cpu_backend() {
        assert!(gpu_library_candidates("linux-common_cpus-x64", &entries()).is_empty());
    }

    // Metal is part of the platform, not a separately loadable backend.
    #[test]
    fn probes_nothing_for_macos() {
        assert!(gpu_library_candidates("macos-arm64", &entries()).is_empty());
    }

    #[test]
    fn reports_a_missing_library_with_its_parsed_name() {
        let result = probe_libraries(&[PathBuf::from("/nonexistent/libggml-cuda.so")]);
        assert_eq!(result.failures.len(), 1, "{result:?}");
        assert_eq!(result.failures[0].library, "libggml-cuda.so");
        assert!(!result.failures[0].error.is_empty());
        assert!(result.loaded.is_empty());
        assert!(!result.inconclusive);
    }

    #[test]
    fn an_empty_target_list_is_conclusive_and_clean() {
        let result = probe_out_of_process(None, &jan_utils::CudaPaths::default(), &[]);
        assert_eq!(result, LoadProbeResult::default());
        assert!(!result.inconclusive);
    }

    // An empty failure list must not be mistaken for a healthy backend when the
    // probe never ran.
    #[test]
    fn inconclusive_is_distinct_from_success() {
        let inconclusive = LoadProbeResult {
            inconclusive: true,
            ..Default::default()
        };
        assert!(inconclusive.failures.is_empty());
        assert_ne!(inconclusive, LoadProbeResult::default());
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Proves the probe's premise against a real install: the GPU library does
    /// NOT resolve without the backend's own directory on the search path, so a
    /// scan that omits that path reports libraries the real process resolves
    /// fine. The positive case cannot be asserted here, because
    /// `probe_out_of_process` re-execs `current_exe`, which under `cargo test`
    /// is the test harness rather than a binary that handles `PROBE_FLAG`; it
    /// requires the app binary wired up in `main.rs`.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a locally installed GPU backend; run with --ignored"]
    fn a_real_backend_library_needs_its_own_directory_on_the_search_path() {
        let Some(bin_dir) = real_backend_bin_dir() else {
            eprintln!("skipped: no installed CUDA/Vulkan backend found");
            return;
        };
        let entries: Vec<String> = std::fs::read_dir(&bin_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        let backend = bin_dir
            .ancestors()
            .nth(2)
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let candidates = gpu_library_candidates(&backend, &entries);
        if candidates.is_empty() {
            eprintln!("skipped: {backend} is not a GPU backend");
            return;
        }
        // The selector must find a real file, not just match a synthetic list.
        for candidate in &candidates {
            assert!(bin_dir.join(candidate).is_file(), "{candidate} missing");
        }

        let targets: Vec<PathBuf> = candidates.iter().map(|c| bin_dir.join(c)).collect();
        let bare = probe_libraries(&targets);

        assert!(
            !bare.failures.is_empty(),
            "expected failure without the search path, proving a scan that omits \
             it cannot be trusted: {bare:?}"
        );
        // And the failure must name a library, which is what drives install advice.
        assert!(
            bare.failures
                .iter()
                .any(|f| !f.missing_libraries.is_empty()),
            "probe failure should name the unresolved library: {bare:?}"
        );
    }

    #[cfg(target_os = "linux")]
    fn real_backend_bin_dir() -> Option<PathBuf> {
        let home = std::env::var("HOME").ok()?;
        let base = PathBuf::from(home).join(".local/share/Jan/data/llamacpp/backends");
        for version in std::fs::read_dir(base).ok()?.filter_map(|e| e.ok()) {
            for backend in std::fs::read_dir(version.path()).ok()?.filter_map(|e| e.ok()) {
                let name = backend.file_name().to_string_lossy().to_string();
                if !["cuda", "vulkan", "hip"].iter().any(|k| name.contains(k)) {
                    continue;
                }
                let bin = backend.path().join("build/bin");
                if bin.is_dir() {
                    return Some(bin);
                }
            }
        }
        None
    }
}
