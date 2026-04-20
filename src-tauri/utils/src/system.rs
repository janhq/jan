use std::path::Path;

/// Returns true when the current process is running inside a Flatpak sandbox
pub fn is_flatpak() -> bool {
    Path::new("/.flatpak-info").exists()
}

/// Checks if npx can be overridden with bun binary
pub fn can_override_npx(bun_path: String) -> bool {
    // We need to check the CPU for the AVX2 instruction support if we are running under MacOS
    // with Intel CPU. We can override `npx` command with `bun` only if CPU is
    // supporting AVX2, otherwise we need to use default `npx` binary
    #[cfg(all(target_os = "macos", any(target_arch = "x86", target_arch = "x86_64")))]
    {
        if !is_x86_feature_detected!("avx2") {
            #[cfg(feature = "logging")]
            log::warn!(
                "Your CPU doesn't support AVX2 instruction, default npx binary will be used"
            );
            return false; // we cannot override npx with bun binary
        }
    }
    // Check if bun_path exists
    if !std::path::Path::new(bun_path.as_str()).exists() {
        #[cfg(feature = "logging")]
        log::warn!(
            "bun binary not found at '{}', default npx binary will be used",
            bun_path
        );
        return false;
    }
    true // by default, we can override npx with bun binary
}

/// Checks if uv_path exists and determines if uvx can be overridden with the uv binary
pub fn can_override_uvx(uv_path: String) -> bool {
    if !std::path::Path::new(uv_path.as_str()).exists() {
        #[cfg(feature = "logging")]
        log::warn!(
            "uv binary not found at '{}', default uvx binary will be used",
            uv_path
        );
        return false;
    }
    true // by default, we can override uvx with uv binary
}

#[derive(Default)]
pub struct CudaPaths {
    pub lib_paths: Vec<String>,
    pub bin_paths: Vec<String>,
}

/// Merges binary lib dir + CUDA paths into a single `command.env()` call per variable.
pub fn setup_library_path(
    library_path: Option<&Path>,
    cuda: &CudaPaths,
    command: &mut tokio::process::Command,
) {
    if cfg!(target_os = "linux") {
        let mut all_lib_dirs: Vec<String> = Vec::new();
        if let Some(lib_path) = library_path {
            all_lib_dirs.push(lib_path.to_string_lossy().to_string());
        }
        all_lib_dirs.extend(cuda.lib_paths.iter().cloned());

        if !all_lib_dirs.is_empty() {
            let current = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let current = current.trim_end_matches(':');
            let new_val = if current.is_empty() {
                all_lib_dirs.join(":")
            } else {
                format!("{}:{}", all_lib_dirs.join(":"), current)
            };
            command.env("LD_LIBRARY_PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("LD_LIBRARY_PATH set to: {}", new_val);
        }

        if !cuda.bin_paths.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            let current = current.trim_end_matches(':');
            let new_val = if current.is_empty() {
                cuda.bin_paths.join(":")
            } else {
                format!("{}:{}", cuda.bin_paths.join(":"), current)
            };
            command.env("PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("PATH set to: {}", new_val);
        }
    } else if cfg!(target_os = "windows") {
        let mut all_dirs: Vec<String> = Vec::new();
        if let Some(lib_path) = library_path {
            let lib_str = lib_path.to_string_lossy();
            let normalized = if lib_str.starts_with(r"\\?\") {
                lib_str[4..].to_string()
            } else {
                lib_str.to_string()
            };
            all_dirs.push(normalized);
        }
        all_dirs.extend(cuda.lib_paths.iter().cloned());
        all_dirs.extend(cuda.bin_paths.iter().cloned());

        if !all_dirs.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            let current = current.trim_end_matches(';');
            let new_val = format!("{};{}", all_dirs.join(";"), current);
            command.env("PATH", &new_val);

            #[cfg(feature = "logging")]
            log::info!("PATH set to: {}", new_val);
        }

        if let Some(lib_path) = library_path {
            command.current_dir(lib_path);
        }
    } else if cfg!(target_os = "macos") {
        if let Some(lib_path) = library_path {
            let lib_str = lib_path.to_string_lossy();
            let new_lib_path = match std::env::var("DYLD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", lib_str, path),
                Err(_) => lib_str.to_string(),
            };
            command.env("DYLD_LIBRARY_PATH", new_lib_path);

            #[cfg(feature = "logging")]
            log::info!("Added to DYLD_LIBRARY_PATH: {}", lib_str);
        }
    } else {
        #[cfg(feature = "logging")]
        log::warn!("Library path setup not supported on this OS");
    }
}

pub fn binary_requires_cuda(_bin_path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return binary_requires_cuda_windows(_bin_path);

    #[cfg(target_os = "linux")]
    return binary_requires_cuda_linux(_bin_path);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    false
}

#[cfg(target_os = "windows")]
fn binary_requires_cuda_windows(bin_path: &Path) -> bool {
    if let Ok(contents) = std::fs::read(bin_path) {
        let contents_str = String::from_utf8_lossy(&contents);
        return contents_str.contains("cudart")
            || contents_str.contains("cublas")
            || contents_str.contains("cufft")
            || contents_str.contains("curand")
            || contents_str.contains("cusparse")
            || contents_str.contains("cusolver")
            || contents_str.contains("cudnn");
    }
    false
}

#[cfg(target_os = "linux")]
fn binary_requires_cuda_linux(bin_path: &Path) -> bool {
    if let Ok(output) = std::process::Command::new("ldd").arg(bin_path).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.contains("libcudart")
                || stdout.contains("libcublas")
                || stdout.contains("libcufft")
                || stdout.contains("libcurand")
                || stdout.contains("libcusparse")
                || stdout.contains("libcusolver")
                || stdout.contains("libcudnn");
        }
    }

    // Fallback: string search if ldd fails
    if let Ok(contents) = std::fs::read(bin_path) {
        let contents_str = String::from_utf8_lossy(&contents);
        return contents_str.contains("libcudart")
            || contents_str.contains("libcublas")
            || contents_str.contains("libcufft");
    }

    false
}

pub fn find_cuda_paths() -> CudaPaths {
    #[cfg(target_os = "windows")]
    return find_cuda_paths_windows();

    #[cfg(target_os = "linux")]
    return find_cuda_paths_linux();

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        #[cfg(feature = "logging")]
        log::debug!("CUDA path detection not implemented for this OS");
        CudaPaths::default()
    }
}

/// Backward-compat wrapper. Prefer `find_cuda_paths()` + `setup_library_path()`.
pub fn add_cuda_paths(command: &mut tokio::process::Command) -> bool {
    let cuda = find_cuda_paths();
    let found = !cuda.lib_paths.is_empty() || !cuda.bin_paths.is_empty();
    setup_library_path(None, &cuda, command);
    found
}

#[cfg(target_os = "windows")]
fn find_cuda_paths_windows() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_bin_paths = HashSet::new();

    if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
        let bin_path = format!(r"{}\bin", cuda_path);
        if Path::new(&bin_path).exists() {
            cuda_bin_paths.insert(bin_path);
        }
    }

    for (key, value) in std::env::vars() {
        if key.starts_with("CUDA_PATH_V") {
            let bin_path = format!(r"{}\bin", value);
            if Path::new(&bin_path).exists() {
                cuda_bin_paths.insert(bin_path);
            }
        }
    }

    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let cuda_toolkit_base = format!(r"{}\NVIDIA GPU Computing Toolkit\CUDA", program_files);

    if let Ok(entries) = std::fs::read_dir(&cuda_toolkit_base) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    cuda_bin_paths.insert(bin_path.to_string_lossy().to_string());
                }
            }
        }
    }

    if cuda_bin_paths.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Windows system");
        return CudaPaths::default();
    }

    let mut bins: Vec<_> = cuda_bin_paths.into_iter().collect();
    bins.sort();

    #[cfg(feature = "logging")]
    log::info!("Found CUDA bin paths: {}", bins.join(", "));

    CudaPaths {
        lib_paths: Vec::new(),
        bin_paths: bins,
    }
}

#[cfg(target_os = "linux")]
fn find_cuda_paths_linux() -> CudaPaths {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_lib_paths = HashSet::new();
    let mut cuda_bin_paths = HashSet::new();

    if let Ok(cuda_path) = std::env::var("CUDA_HOME").or_else(|_| std::env::var("CUDA_PATH")) {
        let lib64_path = format!("{}/lib64", cuda_path);
        let lib_path = format!("{}/lib", cuda_path);
        let bin_path = format!("{}/bin", cuda_path);

        if Path::new(&lib64_path).exists() {
            cuda_lib_paths.insert(lib64_path);
        }
        if Path::new(&lib_path).exists() {
            cuda_lib_paths.insert(lib_path);
        }
        if Path::new(&bin_path).exists() {
            cuda_bin_paths.insert(bin_path);
        }
    }

    let common_paths = [
        "/usr/local/cuda/lib64",
        "/usr/local/cuda/lib",
        "/usr/lib/cuda/lib64",
        "/usr/lib/cuda/lib",
        "/opt/cuda/lib64",
        "/opt/cuda/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/x86_64-linux-gnu/nvidia",
    ];

    for path in &common_paths {
        if Path::new(path).exists() {
            cuda_lib_paths.insert(path.to_string());
        }
    }

    if is_flatpak() {
        collect_flatpak_gl_paths(&mut cuda_lib_paths);
    }

    if let Ok(entries) = std::fs::read_dir("/usr/local") {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("cuda-") {
                    let base = entry.path();
                    for sub in ["lib64", "lib", "bin"] {
                        let sub_path = base.join(sub);
                        if sub_path.exists() {
                            let s = sub_path.to_string_lossy().to_string();
                            if sub == "bin" {
                                cuda_bin_paths.insert(s);
                            } else {
                                cuda_lib_paths.insert(s);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut libs: Vec<_> = cuda_lib_paths.into_iter().collect();
    libs.sort();
    let mut bins: Vec<_> = cuda_bin_paths.into_iter().collect();
    bins.sort();

    if libs.is_empty() && bins.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Linux system");
    } else {
        #[cfg(feature = "logging")]
        {
            if !libs.is_empty() {
                log::info!("Found CUDA lib paths: {}", libs.join(", "));
            }
            if !bins.is_empty() {
                log::info!("Found CUDA bin paths: {}", bins.join(", "));
            }
        }
    }

    CudaPaths {
        lib_paths: libs,
        bin_paths: bins,
    }
}


// ─── HIP / ROCm ──────────────────────────────────────────────────────────────

/// Returns true if the HIP/ROCm runtime is present on the system.
///
/// On Linux this checks for the core `libamdhip64.so` shared library in the
/// standard ROCm installation paths. On Windows it looks for `amdhip64.dll`
/// in the ROCm installation tree and the system library directories.
/// Returns false on all other platforms (macOS etc.).
pub fn is_hip_runtime_available() -> bool {
    #[cfg(target_os = "linux")]
    return is_hip_runtime_available_linux();

    #[cfg(target_os = "windows")]
    return is_hip_runtime_available_windows();

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    false
}

#[cfg(target_os = "linux")]
fn is_hip_runtime_available_linux() -> bool {
    use std::path::Path;

    // Standard ROCm library locations
    let candidates = [
        "/opt/rocm/lib/libamdhip64.so",
        "/usr/lib/libamdhip64.so",
        "/usr/lib/x86_64-linux-gnu/libamdhip64.so",
        "/usr/local/lib/libamdhip64.so",
    ];

    if candidates.iter().any(|p| Path::new(p).exists()) {
        return true;
    }

    // Also accept versioned symlinks: libamdhip64.so.6, libamdhip64.so.5, etc.
    let versioned_dirs = [
        "/opt/rocm/lib",
        "/usr/lib",
        "/usr/lib/x86_64-linux-gnu",
    ];
    for dir in &versioned_dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("libamdhip64.so") {
                    return true;
                }
            }
        }
    }

    // Check HIP_PATH env var (set by some ROCm installers)
    if let Ok(hip_path) = std::env::var("HIP_PATH") {
        let hip_lib = Path::new(&hip_path).join("lib").join("libamdhip64.so");
        if hip_lib.exists() {
            return true;
        }
    }

    false
}

#[cfg(target_os = "windows")]
fn is_hip_runtime_available_windows() -> bool {
    use std::path::Path;

    // ROCm for Windows installs under C:\Program Files\AMD\ROCm
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let rocm_base = Path::new(&program_files).join("AMD").join("ROCm");

    if rocm_base.exists() {
        // Walk one level (versioned sub-dirs like 5.7, 6.0 …)
        if let Ok(entries) = std::fs::read_dir(&rocm_base) {
            for entry in entries.flatten() {
                let dll = entry.path().join("bin").join("amdhip64.dll");
                if dll.exists() {
                    return true;
                }
            }
        }
    }

    // HIP_PATH env var (set by ROCm installer on Windows)
    if let Ok(hip_path) = std::env::var("HIP_PATH") {
        let dll = Path::new(&hip_path).join("bin").join("amdhip64.dll");
        if dll.exists() {
            return true;
        }
    }

    // System-wide fallback (e.g. copied into System32)
    let system32 = Path::new(r"C:\Windows\System32\amdhip64.dll");
    system32.exists()
}

/// Adds ROCm/HIP library and binary paths to the command's environment so that
/// a HIP-linked llama-server can find `libamdhip64` at launch time.
///
/// Returns `true` if any ROCm paths were discovered and injected.
pub fn add_hip_paths(_command: &mut tokio::process::Command) -> bool {
    #[cfg(target_os = "linux")]
    return add_hip_paths_linux(_command);

    #[cfg(target_os = "windows")]
    return add_hip_paths_windows(_command);

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = _command;
        false
    }
}

#[cfg(target_os = "linux")]
fn add_hip_paths_linux(command: &mut tokio::process::Command) -> bool {
    use std::collections::HashSet;
    use std::path::Path;

    let mut lib_paths: HashSet<String> = HashSet::new();

    // Collect candidate ROCm library directories
    let static_dirs = [
        "/opt/rocm/lib",
        "/opt/rocm/lib64",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib",
        "/usr/local/lib",
    ];
    for dir in &static_dirs {
        if Path::new(dir).exists() {
            lib_paths.insert(dir.to_string());
        }
    }

    // HIP_PATH / ROCM_PATH env vars
    for var in &["HIP_PATH", "ROCM_PATH"] {
        if let Ok(val) = std::env::var(var) {
            for sub in &["lib", "lib64"] {
                let p = Path::new(&val).join(sub);
                if p.exists() {
                    lib_paths.insert(p.to_string_lossy().to_string());
                }
            }
        }
    }

    // Walk /opt/rocm-* versioned installs
    if let Ok(entries) = std::fs::read_dir("/opt") {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("rocm") {
                for sub in &["lib", "lib64"] {
                    let p = entry.path().join(sub);
                    if p.exists() {
                        lib_paths.insert(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    if lib_paths.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("ROCm/HIP not found on Linux system");
        return false;
    }

    let mut libs: Vec<_> = lib_paths.into_iter().collect();
    libs.sort();

    let current = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
    let current = current.trim_end_matches(':');
    let new_val = if current.is_empty() {
        libs.join(":")
    } else {
        format!("{}:{}", libs.join(":"), current)
    };
    command.env("LD_LIBRARY_PATH", new_val);

    #[cfg(feature = "logging")]
    log::info!("Added ROCm paths to LD_LIBRARY_PATH: {}", libs.join(", "));

    true
}

#[cfg(target_os = "windows")]
fn add_hip_paths_windows(command: &mut tokio::process::Command) -> bool {
    use std::collections::HashSet;
    use std::path::Path;

    let mut bin_paths: HashSet<String> = HashSet::new();

    // C:\Program Files\AMD\ROCm\<version>\bin
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let rocm_base = Path::new(&program_files).join("AMD").join("ROCm");
    if let Ok(entries) = std::fs::read_dir(&rocm_base) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            if bin.exists() {
                bin_paths.insert(bin.to_string_lossy().to_string());
            }
        }
    }

    // HIP_PATH env var
    if let Ok(hip_path) = std::env::var("HIP_PATH") {
        let bin = Path::new(&hip_path).join("bin");
        if bin.exists() {
            bin_paths.insert(bin.to_string_lossy().to_string());
        }
    }

    if bin_paths.is_empty() {
        #[cfg(feature = "logging")]
        log::debug!("ROCm/HIP not found on Windows system");
        return false;
    }

    let mut bins: Vec<_> = bin_paths.into_iter().collect();
    bins.sort();

    let current = std::env::var("PATH").unwrap_or_default();
    let current = current.trim_end_matches(';');
    let new_val = format!("{};{}", bins.join(";"), current);
    command.env("PATH", new_val);

    #[cfg(feature = "logging")]
    log::info!("Added ROCm paths to PATH: {}", bins.join(", "));

    true
}

/// Returns true if the binary at `bin_path` is linked against HIP/ROCm libraries.
///
/// On Linux uses `ldd`; on Windows scans the PE import table for `amdhip64`.
pub fn binary_requires_hip(_bin_path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return binary_requires_hip_windows(_bin_path);

    #[cfg(target_os = "linux")]
    return binary_requires_hip_linux(_bin_path);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    false
}

#[cfg(target_os = "linux")]
fn binary_requires_hip_linux(bin_path: &Path) -> bool {
    if let Ok(output) = std::process::Command::new("ldd").arg(bin_path).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.contains("libamdhip64") || stdout.contains("librocblas");
        }
    }
    // Fallback: byte-search the ELF string table
    if let Ok(contents) = std::fs::read(bin_path) {
        let s = String::from_utf8_lossy(&contents);
        return s.contains("libamdhip64") || s.contains("librocblas");
    }
    false
}

#[cfg(target_os = "windows")]
fn binary_requires_hip_windows(bin_path: &Path) -> bool {
    if let Ok(contents) = std::fs::read(bin_path) {
        let s = String::from_utf8_lossy(&contents);
        return s.contains("amdhip64") || s.contains("rocblas");
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────────


#[cfg(target_os = "linux")]
fn collect_flatpak_gl_paths(cuda_lib_paths: &mut std::collections::HashSet<String>) {
    let flatpak_gl_paths = [
        "/usr/lib/extensions/vulkan/nvidia/lib",
        "/usr/lib/extensions/cuda/lib",
        "/usr/lib/GL/lib",
        "/usr/lib/GL",
        "/app/lib/GL",
    ];

    for path in &flatpak_gl_paths {
        if Path::new(path).exists() {
            cuda_lib_paths.insert(path.to_string());
        }
    }

    for base_dir in ["/usr/lib/extensions", "/usr/lib/GL/lib"] {
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !entry_path.is_dir() {
                    continue;
                }

                let lib_sub = entry_path.join("lib");
                if lib_sub.exists() {
                    cuda_lib_paths.insert(lib_sub.to_string_lossy().to_string());
                } else {
                    cuda_lib_paths.insert(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(feature = "logging")]
    log::info!("Searched Flatpak GL extension paths for NVIDIA libraries");
}

pub fn setup_windows_process_flags(command: &mut tokio::process::Command) {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        let _ = command; // Silence unused parameter warning on non-Windows platforms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Spawns a child to read env vars since Command doesn't expose a getter.
    async fn read_env_from_child(command: &mut tokio::process::Command, var: &str) -> String {
        use std::process::Stdio;
        #[cfg(target_os = "linux")]
        command.args(["-c", &format!("printenv {} || true", var)]);
        #[cfg(target_os = "windows")]
        command.args(["/C", &format!("echo %{}%", var)]);

        let output = command
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .expect("failed to spawn helper process");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn new_shell_command() -> tokio::process::Command {
        #[cfg(target_os = "linux")]
        return tokio::process::Command::new("sh");
        #[cfg(target_os = "windows")]
        return tokio::process::Command::new("cmd");
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        return tokio::process::Command::new("sh");
    }

    #[test]
    fn cuda_paths_default_is_empty() {
        let cp = CudaPaths::default();
        assert!(cp.lib_paths.is_empty());
        assert!(cp.bin_paths.is_empty());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_merges_binary_dir_and_cuda_libs() {
        let cuda = CudaPaths {
            lib_paths: vec!["/fake/cuda/lib64".into()],
            bin_paths: vec!["/fake/cuda/bin".into()],
        };
        let bin_dir = Path::new("/fake/bin_dir");

        let mut cmd = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/bin_dir"),
            "LD_LIBRARY_PATH should contain binary dir, got: {}",
            ld
        );
        assert!(
            ld.contains("/fake/cuda/lib64"),
            "LD_LIBRARY_PATH should contain CUDA lib dir, got: {}",
            ld
        );

        let mut cmd2 = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd2);
        let path = read_env_from_child(&mut cmd2, "PATH").await;
        assert!(
            path.contains("/fake/cuda/bin"),
            "PATH should contain CUDA bin dir, got: {}",
            path
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_no_cuda_still_sets_binary_dir() {
        let cuda = CudaPaths::default();
        let bin_dir = Path::new("/fake/bin_dir");

        let mut cmd = new_shell_command();
        setup_library_path(Some(bin_dir), &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/bin_dir"),
            "LD_LIBRARY_PATH should contain binary dir even without CUDA, got: {}",
            ld
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_no_binary_dir_still_sets_cuda() {
        let cuda = CudaPaths {
            lib_paths: vec!["/fake/cuda/lib64".into()],
            bin_paths: vec![],
        };

        let mut cmd = new_shell_command();
        setup_library_path(None, &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.contains("/fake/cuda/lib64"),
            "LD_LIBRARY_PATH should contain CUDA lib dir, got: {}",
            ld
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn setup_library_path_empty_inputs_does_not_set_env() {
        let cuda = CudaPaths::default();
        let mut cmd = new_shell_command();

        cmd.env_remove("LD_LIBRARY_PATH");
        setup_library_path(None, &cuda, &mut cmd);

        let ld = read_env_from_child(&mut cmd, "LD_LIBRARY_PATH").await;
        assert!(
            ld.is_empty(),
            "LD_LIBRARY_PATH should not be set when both inputs are empty, got: {}",
            ld
        );
    }

    #[test]
    fn binary_requires_cuda_returns_false_for_nonexistent_file() {
        assert!(!binary_requires_cuda(Path::new("/nonexistent/binary")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn binary_requires_cuda_returns_false_for_non_cuda_binary() {
        assert!(!binary_requires_cuda(Path::new("/bin/sh")));
    }

    #[test]
    fn find_cuda_paths_returns_valid_struct() {
        let cp = find_cuda_paths();
        for p in &cp.lib_paths {
            assert!(
                Path::new(p).exists(),
                "Returned lib path should exist: {}",
                p
            );
        }
        for p in &cp.bin_paths {
            assert!(
                Path::new(p).exists(),
                "Returned bin path should exist: {}",
                p
            );
        }
    }

    #[tokio::test]
    async fn add_cuda_paths_compat_wrapper_does_not_panic() {
        let mut cmd = new_shell_command();
        let _found = add_cuda_paths(&mut cmd);
    }

    #[test]
    fn is_flatpak_returns_bool() {
        let result = is_flatpak();
        if Path::new("/.flatpak-info").exists() {
            assert!(result);
        } else {
            assert!(!result);
        }
    }
}
