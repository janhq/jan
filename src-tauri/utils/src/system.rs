use std::path::Path;

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

/// Setup library paths for different operating systems
pub fn setup_library_path(library_path: Option<&Path>, command: &mut tokio::process::Command) {
    if let Some(lib_path) = library_path {
        if cfg!(target_os = "linux") {
            let lib_str = lib_path.to_string_lossy();
            let new_lib_path = match std::env::var("LD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", lib_str, path),
                Err(_) => lib_str.to_string(),
            };
            command.env("LD_LIBRARY_PATH", new_lib_path);

            #[cfg(feature = "logging")]
            log::info!("Added to LD_LIBRARY_PATH: {}", lib_str);
        } else if cfg!(target_os = "windows") {
            let lib_str = lib_path.to_string_lossy();

            // Normalize UNC prefix
            let normalized_str = if lib_str.starts_with(r"\\?\") {
                &lib_str[4..]
            } else {
                lib_str.as_ref()
            };

            let new_path = match std::env::var("PATH") {
                Ok(path) => format!("{};{}", normalized_str, path),
                Err(_) => normalized_str.to_string(),
            };
            command.env("PATH", &new_path);

            #[cfg(feature = "logging")]
            log::info!("Added to PATH: {}", normalized_str);

            command.current_dir(lib_path);
        } else if cfg!(target_os = "macos") {
            let lib_str = lib_path.to_string_lossy();
            let new_lib_path = match std::env::var("DYLD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", lib_str, path),
                Err(_) => lib_str.to_string(),
            };
            command.env("DYLD_LIBRARY_PATH", new_lib_path);

            #[cfg(feature = "logging")]
            log::info!("Added to DYLD_LIBRARY_PATH: {}", lib_str);
        } else {
            #[cfg(feature = "logging")]
            log::warn!("Library path setup not supported on this OS");
        }
    }
}

pub fn binary_requires_cuda(bin_path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return binary_requires_cuda_windows(bin_path);

    #[cfg(target_os = "linux")]
    return binary_requires_cuda_linux(bin_path);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    false
}

#[cfg(target_os = "windows")]
fn binary_requires_cuda_windows(bin_path: &Path) -> bool {
    // Check if the binary imports CUDA DLLs
    // This is a simplified check - looks for common CUDA DLL names in the binary
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
    // Use 'ldd' to check for CUDA library dependencies
    // This is more reliable than string searching
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

    // Fallback: simple string search in binary (less reliable on Linux)
    if let Ok(contents) = std::fs::read(bin_path) {
        let contents_str = String::from_utf8_lossy(&contents);
        return contents_str.contains("libcudart")
            || contents_str.contains("libcublas")
            || contents_str.contains("libcufft");
    }

    false
}

/// Adds CUDA paths to the command's environment based on the OS.
pub fn add_cuda_paths(command: &mut tokio::process::Command) -> bool {
    #[cfg(target_os = "windows")]
    return add_cuda_paths_windows(command);

    #[cfg(target_os = "linux")]
    return add_cuda_paths_linux(command);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        #[cfg(feature = "logging")]
        log::debug!("CUDA path detection not implemented for this OS");
        false
    }
}

#[cfg(target_os = "windows")]
pub fn add_cuda_paths_windows(command: &mut tokio::process::Command) -> bool {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_paths = HashSet::new();

    // Check CUDA_PATH env var
    if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
        let bin_path = format!(r"{}\bin", cuda_path);
        if Path::new(&bin_path).exists() {
            cuda_paths.insert(bin_path);
        }
    }

    // Check versioned CUDA_PATH_Vxx_x env vars
    for (key, value) in std::env::vars() {
        if key.starts_with("CUDA_PATH_V") {
            let bin_path = format!(r"{}\bin", value);
            if Path::new(&bin_path).exists() {
                cuda_paths.insert(bin_path);
            }
        }
    }

    // Check common installation directories
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let cuda_toolkit_base = format!(r"{}\NVIDIA GPU Computing Toolkit\CUDA", program_files);

    if let Ok(entries) = std::fs::read_dir(&cuda_toolkit_base) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    cuda_paths.insert(bin_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // Update PATH if we found CUDA
    if !cuda_paths.is_empty() {
        let mut paths: Vec<_> = cuda_paths.into_iter().collect();
        paths.sort();

        let current_path = std::env::var("PATH").unwrap_or_default();
        let current_path = current_path.trim_end_matches(';');
        let new_path = format!("{};{}", paths.join(";"), current_path);

        command.env("PATH", new_path);

        #[cfg(feature = "logging")]
        log::info!("Added CUDA paths to PATH: {}", paths.join(", "));

        true
    } else {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Windows system");
        false
    }
}

#[cfg(target_os = "linux")]
pub fn add_cuda_paths_linux(command: &mut tokio::process::Command) -> bool {
    use std::collections::HashSet;
    use std::path::Path;

    let mut cuda_lib_paths = HashSet::new();
    let mut cuda_bin_paths = HashSet::new();

    // Check CUDA_HOME or CUDA_PATH environment variables
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

    // Common CUDA directories
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

    // Version-specific installs like /usr/local/cuda-12.2
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

    // Merge and inject paths
    let mut modified = false;

    if !cuda_lib_paths.is_empty() {
        let mut libs: Vec<_> = cuda_lib_paths.into_iter().collect();
        libs.sort();

        let current_ld_path = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let current_ld_path = current_ld_path.trim_end_matches(':');
        let new_ld_path = if current_ld_path.is_empty() {
            libs.join(":")
        } else {
            format!("{}:{}", libs.join(":"), current_ld_path)
        };

        command.env("LD_LIBRARY_PATH", new_ld_path);
        modified = true;

        #[cfg(feature = "logging")]
        log::info!("Added CUDA libs to LD_LIBRARY_PATH: {}", libs.join(", "));
    }

    if !cuda_bin_paths.is_empty() {
        let mut bins: Vec<_> = cuda_bin_paths.into_iter().collect();
        bins.sort();

        let current_path = std::env::var("PATH").unwrap_or_default();
        let current_path = current_path.trim_end_matches(':');
        let new_path = if current_path.is_empty() {
            bins.join(":")
        } else {
            format!("{}:{}", bins.join(":"), current_path)
        };

        command.env("PATH", new_path);
        modified = true;

        #[cfg(feature = "logging")]
        log::info!("Added CUDA bins to PATH: {}", bins.join(", "));
    }

    if !modified {
        #[cfg(feature = "logging")]
        log::debug!("CUDA not found on Linux system");
    }

    modified
}

/// Setup Windows-specific process creation flags
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
