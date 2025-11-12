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
                Ok(path) => format!("{}:{}", path, lib_str),
                Err(_) => lib_str.to_string(),
            };
            command.env("LD_LIBRARY_PATH", new_lib_path);
        } else if cfg!(target_os = "windows") {
            let lib_str = lib_path.to_string_lossy();
            let new_path = match std::env::var("PATH") {
                Ok(path) => format!("{};{}", path, lib_str),
                Err(_) => lib_str.to_string(),
            };
            command.env("PATH", &new_path);

            // Normalize UNC prefix (`\\?\C:\path\to\dir`) if present
            let mut normalized = lib_path.as_os_str().to_owned();
            const UNC_PREFIX: &str = r"\\?\";
            if let Some(s) = lib_path.to_str() {
                if s.starts_with(UNC_PREFIX) {
                    normalized = std::ffi::OsString::from(&s[UNC_PREFIX.len()..]);
                }
            }
            let normalized_path = std::path::PathBuf::from(normalized);

            #[cfg(feature = "logging")]
            log::info!("Library path: {}", normalized_path.display());

            if normalized_path.exists() && normalized_path.is_dir() {
                command.current_dir(&normalized_path);
            } else {
                #[cfg(feature = "logging")]
                log::warn!(
                    "Library path '{}' does not exist or is not a directory",
                    normalized_path.display()
                );
            }
        } else {
            #[cfg(feature = "logging")]
            log::warn!("Library path setup not supported on this OS");
        }
    }
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
