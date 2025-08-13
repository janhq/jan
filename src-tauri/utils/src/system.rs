/// Checks AVX2 CPU support for npx override with bun binary
pub fn can_override_npx() -> bool {
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

    true // by default, we can override npx with bun binary
}

/// Setup library paths for different operating systems
pub fn setup_library_path(library_path: Option<&str>, command: &mut tokio::process::Command) {
    if let Some(lib_path) = library_path {
        if cfg!(target_os = "linux") {
            let new_lib_path = match std::env::var("LD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", path, lib_path),
                Err(_) => lib_path.to_string(),
            };
            command.env("LD_LIBRARY_PATH", new_lib_path);
        } else if cfg!(target_os = "windows") {
            let new_path = match std::env::var("PATH") {
                Ok(path) => format!("{};{}", path, lib_path),
                Err(_) => lib_path.to_string(),
            };
            command.env("PATH", new_path);

            // Normalize the path by removing UNC prefix if present
            let normalized_path = lib_path.trim_start_matches(r"\\?\").to_string();
            #[cfg(feature = "logging")]
            log::info!("Library path:\n{}", &normalized_path);

            // Only set current_dir if the normalized path exists and is a directory
            let path = std::path::Path::new(&normalized_path);
            if path.exists() && path.is_dir() {
                command.current_dir(&normalized_path);
            } else {
                #[cfg(feature = "logging")]
                log::warn!(
                    "Library path '{}' does not exist or is not a directory",
                    normalized_path
                );
            }
        } else {
            #[cfg(feature = "logging")]
            log::warn!("Library path setting is not supported on this OS");
        }
    }
}

/// Setup Windows-specific process creation flags
pub fn setup_windows_process_flags(command: &mut tokio::process::Command) {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        let _ = command; // Silence unused parameter warning on non-Windows platforms
    }
}
