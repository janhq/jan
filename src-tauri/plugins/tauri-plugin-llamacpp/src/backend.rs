use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn map_old_backend_to_new(old_backend: String) -> String {
    let is_windows = old_backend.starts_with("win-");
    let is_linux = old_backend.starts_with("linux-");
    let os_prefix = if is_windows {
        "win-"
    } else if is_linux {
        "linux-"
    } else {
        ""
    };

    // Determine architecture suffix, defaulting to x64
    let arch_suffix = if old_backend.contains("-arm64") {
        "arm64"
    } else {
        "x64"
    };
    let is_x64 = arch_suffix == "x64";

    // Handle GPU backends
    if old_backend.contains("cuda-cu12.0") {
        // Migration from e.g., 'linux-avx2-cuda-cu12.0-x64' to 'linux-cuda-12-common_cpus-x64'
        return format!(
            "{}cuda-12-common_cpus-{}",
            os_prefix,
            if is_x64 { "x64" } else { arch_suffix }
        );
    } else if old_backend.contains("cuda-cu11.7") {
        // Migration from e.g., 'win-noavx-cuda-cu11.7-x64' to 'win-cuda-11-common_cpus-x64'
        return format!(
            "{}cuda-11-common_cpus-{}",
            os_prefix,
            if is_x64 { "x64" } else { arch_suffix }
        );
    } else if old_backend.contains("vulkan") {
        // If it's already the new name, return it
        if old_backend.contains("vulkan-common_cpus") {
            return old_backend;
        }

        // Migration from e.g., 'linux-vulkan-x64' to 'linux-vulkan-common_cpus-x64'
        return format!(
            "{}vulkan-common_cpus-{}",
            os_prefix,
            if is_x64 { "x64" } else { arch_suffix }
        );
    }

    // Handle CPU-only backends (avx, avx2, avx512, noavx)
    let is_old_cpu_backend = old_backend.contains("avx512")
        || old_backend.contains("avx2")
        || old_backend.contains("avx-x64") // Check for 'avx' but not as part of 'avx2' or 'avx512'
        || old_backend.contains("noavx-x64");

    if is_old_cpu_backend {
        // Migration from e.g., 'win-avx512-x64' to 'win-common_cpus-x64'
        return format!(
            "{}common_cpus-{}",
            os_prefix,
            if is_x64 { "x64" } else { arch_suffix }
        );
    }

    // Return original if it doesn't match a pattern that needs migration
    old_backend
}

#[derive(Serialize, Deserialize)]
pub struct InstalledBackend {
    version: String,
    backend: String,
}

#[tauri::command]
pub async fn get_local_installed_backends(
    backends_dir: String,
) -> Result<Vec<InstalledBackend>, String> {
    let mut local: Vec<InstalledBackend> = Vec::new();
    let backends_path = PathBuf::from(&backends_dir);

    // Check if backends directory exists
    if !backends_path.exists() {
        return Ok(local);
    }

    // Read version directories
    let version_dirs = fs::read_dir(&backends_path)
        .map_err(|e| format!("Failed to read backends directory: {}", e))?;

    for version_entry in version_dirs {
        let version_entry =
            version_entry.map_err(|e| format!("Failed to read version entry: {}", e))?;

        let version_path = version_entry.path();

        // Check if it's a directory
        let metadata =
            fs::metadata(&version_path).map_err(|e| format!("Failed to get metadata: {}", e))?;

        if !metadata.is_dir() {
            continue;
        }

        // Get version name from path
        let version_name = match version_path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };

        // Read backend types in this version directory
        let backend_types = fs::read_dir(&version_path)
            .map_err(|e| format!("Failed to read version directory: {}", e))?;

        for backend_entry in backend_types {
            let backend_entry =
                backend_entry.map_err(|e| format!("Failed to read backend entry: {}", e))?;

            let backend_path = backend_entry.path();

            // Get backend name from path
            let backend_name = match backend_path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => continue,
            };

            // Check if backend is actually installed
            if is_backend_installed(&backend_path) {
                local.push(InstalledBackend {
                    version: version_name.clone(),
                    backend: backend_name,
                });
            }
        }
    }

    Ok(local)
}

/// Helper function to check if a backend is properly installed
/// Checks for the existence of llama-server executable in the expected locations
fn is_backend_installed(backend_dir: &PathBuf) -> bool {
    if !backend_dir.exists() || !backend_dir.is_dir() {
        return false;
    }

    // Determine executable name based on platform
    let exe_name = if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    // First check if build directory exists (build/bin/llama-server)
    let build_path = backend_dir.join("build").join("bin").join(exe_name);
    if build_path.exists() {
        return true;
    }

    // Otherwise check root directory (llama-server)
    let root_path = backend_dir.join(exe_name);
    root_path.exists()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BackendInfo {
    version: String,
    backend: String,
}

#[derive(Deserialize)]
pub struct SystemFeatures {
    cuda11: bool,
    cuda12: bool,
    cuda13: bool,
    vulkan: bool,
}

#[derive(Serialize)]
#[allow(dead_code)]
pub struct SupportedBackendsResult {
    supported_backend_names: Vec<String>,
    merged_backends: Vec<BackendInfo>,
}

#[tauri::command]
pub fn determine_supported_backends(
    os_type: String,
    arch: String,
    features: SystemFeatures,
) -> Result<Vec<String>, String> {
    let sys_type = format!("{}-{}", os_type, arch);
    let mut supported_backends: Vec<String> = Vec::new();

    // Determine supported backends based on system type and features
    match sys_type.as_str() {
        "windows-x86_64" => {
            supported_backends.push("win-common_cpus-x64".to_string());
            if features.cuda11 {
                supported_backends.push("win-cuda-11-common_cpus-x64".to_string());
            }
            if features.cuda12 {
                supported_backends.push("win-cuda-12-common_cpus-x64".to_string());
            }
            if features.cuda13 {
                supported_backends.push("win-cuda-13-common_cpus-x64".to_string());
            }
            if features.vulkan {
                supported_backends.push("win-vulkan-common_cpus-x64".to_string());
            }
        }
        "windows-aarch64" | "windows-arm64" => {
            supported_backends.push("win-arm64".to_string());
        }
        "linux-x86_64" | "linux-x86" => {
            supported_backends.push("linux-common_cpus-x64".to_string());
            if features.cuda11 {
                supported_backends.push("linux-cuda-11-common_cpus-x64".to_string());
            }
            if features.cuda12 {
                supported_backends.push("linux-cuda-12-common_cpus-x64".to_string());
            }
            if features.cuda13 {
                supported_backends.push("linux-cuda-13-common_cpus-x64".to_string());
            }
            if features.vulkan {
                supported_backends.push("linux-vulkan-common_cpus-x64".to_string());
            }
        }
        "linux-aarch64" | "linux-arm64" => {
            supported_backends.push("linux-arm64".to_string());
        }
        "macos-x86_64" | "macos-x86" => {
            supported_backends.push("macos-x64".to_string());
        }
        "macos-aarch64" | "macos-arm64" => {
            supported_backends.push("macos-arm64".to_string());
        }
        _ => {
            return Err(format!("Unsupported system type: {}", sys_type));
        }
    }

    Ok(supported_backends)
}

#[tauri::command]
pub async fn list_supported_backends(
    remote_backend_versions: Vec<BackendInfo>,
    local_backend_versions: Vec<BackendInfo>,
) -> Result<Vec<BackendInfo>, String> {
    // Merge remote and local backend versions with deduplication
    let mut merged_map: HashMap<String, BackendInfo> = HashMap::new();

    for entry in remote_backend_versions {
        let key = format!("{}|{}", entry.version, entry.backend);
        merged_map.insert(key, entry);
    }

    for entry in local_backend_versions {
        let key = format!("{}|{}", entry.version, entry.backend);
        merged_map.insert(key, entry);
    }

    // Convert to vector and sort
    let mut merged: Vec<BackendInfo> = merged_map.into_values().collect();

    // Sort newest version first; if versions tie, sort by backend name
    merged.sort_by(|a, b| {
        let version_cmp = b.version.cmp(&a.version);
        if version_cmp == std::cmp::Ordering::Equal {
            a.backend.cmp(&b.backend)
        } else {
            version_cmp
        }
    });

    Ok(merged)
}

#[derive(Serialize, Deserialize)]
pub struct SupportedFeatures {
    avx: bool,
    avx2: bool,
    avx512: bool,
    cuda11: bool,
    cuda12: bool,
    cuda13: bool,
    vulkan: bool,
}

#[derive(Deserialize)]
pub struct GpuInfo {
    driver_version: String,
    nvidia_info: Option<NvidiaInfo>,
    vulkan_info: Option<VulkanInfo>,
}

#[derive(Deserialize)]
pub struct NvidiaInfo {
    #[allow(dead_code)]
    compute_capability: String,
}

#[derive(Deserialize)]
pub struct VulkanInfo {
    #[allow(dead_code)]
    api_version: String,
}

#[tauri::command]
pub fn get_supported_features(
    os_type: String,
    cpu_extensions: Vec<String>,
    gpus: Vec<GpuInfo>,
) -> Result<SupportedFeatures, String> {
    let mut features = SupportedFeatures {
        avx: cpu_extensions.contains(&"avx".to_string()),
        avx2: cpu_extensions.contains(&"avx2".to_string()),
        avx512: cpu_extensions.contains(&"avx512".to_string()),
        cuda11: false,
        cuda12: false,
        cuda13: false,
        vulkan: false,
    };

    // https://docs.nvidia.com/deploy/cuda-compatibility/#cuda-11-and-later-defaults-to-minor-version-compatibility
    let (min_cuda11_driver, min_cuda12_driver, min_cuda13_driver) = match os_type.as_str() {
        "linux" => ("450.80.02", "525.60.13", "580"),
        "windows" => ("452.39", "527.41", "580"),
        _ => return Ok(features), // Other OS types don't support CUDA
    };

    // Check GPU features
    for gpu_info in gpus {
        let driver_version = &gpu_info.driver_version;

        // Check CUDA support
        if gpu_info.nvidia_info.is_some() {
            if compare_versions(driver_version, min_cuda11_driver) >= 0 {
                features.cuda11 = true;
            }
            if compare_versions(driver_version, min_cuda12_driver) >= 0 {
                features.cuda12 = true;
            }
            if compare_versions(driver_version, min_cuda13_driver) >= 0 {
                features.cuda13 = true;
            }
        }

        // Check Vulkan support
        if gpu_info.vulkan_info.is_some() {
            features.vulkan = true;
        }
    }

    Ok(features)
}

/// Compare version strings
/// Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
fn compare_versions(v1: &str, v2: &str) -> i32 {
    let parts1: Vec<&str> = v1.split('.').collect();
    let parts2: Vec<&str> = v2.split('.').collect();

    let max_len = parts1.len().max(parts2.len());

    for i in 0..max_len {
        let num1 = parts1
            .get(i)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let num2 = parts2
            .get(i)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);

        match num1.cmp(&num2) {
            std::cmp::Ordering::Less => return -1,
            std::cmp::Ordering::Greater => return 1,
            std::cmp::Ordering::Equal => continue,
        }
    }

    0
}

#[tauri::command]
pub async fn is_cuda_installed(
    backend_dir: String,
    version: String,
    os_type: String,
    jan_data_folder_path: String,
) -> Result<bool, String> {
    // Define library name lookup table
    let mut libname_lookup: HashMap<String, &str> = HashMap::new();
    libname_lookup.insert("windows-11.7".to_string(), "cudart64_110.dll");
    libname_lookup.insert("windows-12.0".to_string(), "cudart64_12.dll");
    libname_lookup.insert("windows-13.0".to_string(), "cudart64_13.dll");
    libname_lookup.insert("linux-11.7".to_string(), "libcudart.so.11.0");
    libname_lookup.insert("linux-12.0".to_string(), "libcudart.so.12");
    libname_lookup.insert("linux-13.0".to_string(), "libcudart.so.13");

    let key = format!("{}-{}", os_type, version);

    // Check if the OS-version combination is supported
    let libname = match libname_lookup.get(&key) {
        Some(name) => *name,
        None => return Ok(false),
    };

    // Expected new location: backend_dir/build/bin/libname
    let new_path = std::path::PathBuf::from(&backend_dir)
        .join("build")
        .join("bin")
        .join(libname);

    if new_path.exists() {
        return Ok(true);
    }

    // Old location (used by older builds): jan_data_folder_path/llamacpp/lib/libname
    let old_path = std::path::PathBuf::from(&jan_data_folder_path)
        .join("llamacpp")
        .join("lib")
        .join(libname);

    if old_path.exists() {
        // Ensure target directory exists
        let target_dir = PathBuf::from(&backend_dir).join("build").join("bin");

        if !target_dir.exists() {
            fs::create_dir_all(&target_dir)
                .map_err(|e| format!("Failed to create target directory: {}", e))?;
        }

        // Move old lib to the correct new location
        match fs::rename(&old_path, &new_path) {
            Ok(_) => {
                log::info!("[CUDA] Migrated {} from old path to new location.", libname);
                return Ok(true);
            }
            Err(err) => {
                log::warn!("[CUDA] Failed to move old library: {}", err);
                // Return false since the migration failed
                return Ok(false);
            }
        }
    }

    Ok(false)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BestBackendResult {
    pub backend_string: String,
    pub version: String,
    pub backend_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateCheckResult {
    pub update_needed: bool,
    pub new_version: String,
    pub target_backend: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct BackendConfigResult {
    pub best_available: String,
    pub effective_backend: String,
    pub backend_downloaded: bool,
    pub settings_updated: bool,
}

#[tauri::command]
pub fn find_latest_version_for_backend(
    version_backends: Vec<BackendInfo>,
    backend_type: String,
) -> Option<String> {
    let mut matching_backends: Vec<BackendInfo> = version_backends
        .into_iter()
        .filter(|vb| map_old_backend_to_new(vb.backend.clone()) == backend_type)
        .collect();

    if matching_backends.is_empty() {
        return None;
    }

    // Sort by version (newest first)
    matching_backends.sort_by(|a, b| b.version.cmp(&a.version));

    // Return the full string including the original asset name
    Some(format!(
        "{}/{}",
        matching_backends[0].version, matching_backends[0].backend
    ))
}

#[tauri::command]
pub async fn prioritize_backends(
    version_backends: Vec<BackendInfo>,
    has_enough_gpu_memory: bool,
) -> Result<BestBackendResult, String> {
    if version_backends.is_empty() {
        return Err("No backends available".to_string());
    }

    // Priority list based on GPU memory
    let backend_priorities: Vec<&str> = if has_enough_gpu_memory {
        vec![
            "cuda-cu13.0",
            "cuda-cu12.0",
            "cuda-cu11.7",
            "vulkan",
            "common_cpus",
            "avx512",
            "avx2",
            "avx",
            "noavx",
            "arm64",
            "x64",
        ]
    } else {
        vec![
            "common_cpus",
            "avx512",
            "avx2",
            "avx",
            "noavx",
            "arm64",
            "x64",
            "vulkan",
        ]
    };

    // Find best matching backend
    for priority_category in backend_priorities {
        let matching_backends: Vec<&BackendInfo> = version_backends
            .iter()
            .filter(|vb| {
                let category = get_backend_category(&vb.backend);
                category.as_deref() == Some(priority_category)
            })
            .collect();

        if !matching_backends.is_empty() {
            let best = matching_backends[0];
            log::info!(
                "Determined best available backend: {}/{} (Category: \"{}\")",
                best.version,
                best.backend,
                priority_category
            );

            return Ok(BestBackendResult {
                backend_string: format!("{}/{}", best.version, best.backend),
                version: best.version.clone(),
                backend_type: best.backend.clone(),
            });
        }
    }

    // Fallback to newest version
    let fallback = &version_backends[0];
    log::info!("Fallback to: {}/{}", fallback.version, fallback.backend);

    Ok(BestBackendResult {
        backend_string: format!("{}/{}", fallback.version, fallback.backend),
        version: fallback.version.clone(),
        backend_type: fallback.backend.clone(),
    })
}

fn get_backend_category(backend_string: &str) -> Option<String> {
    if backend_string.contains("cuda-13-common_cpus") {
        return Some("cuda-cu13.0".to_string());
    }
    if backend_string.contains("cuda-12-common_cpus") || backend_string.contains("cu12.0") {
        return Some("cuda-cu12.0".to_string());
    }
    if backend_string.contains("cuda-11-common_cpus") || backend_string.contains("cu11.7") {
        return Some("cuda-cu11.7".to_string());
    }
    if backend_string.contains("vulkan") {
        return Some("vulkan".to_string());
    }
    if backend_string.contains("common_cpus") {
        return Some("common_cpus".to_string());
    }
    if backend_string.contains("avx512") {
        return Some("avx512".to_string());
    }
    if backend_string.contains("avx2") {
        return Some("avx2".to_string());
    }
    if backend_string.contains("avx")
        && !backend_string.contains("avx2")
        && !backend_string.contains("avx512")
    {
        return Some("avx".to_string());
    }
    if backend_string.contains("noavx") {
        return Some("noavx".to_string());
    }
    if backend_string.ends_with("arm64") {
        return Some("arm64".to_string());
    }
    if backend_string.ends_with("x64") {
        return Some("x64".to_string());
    }
    None
}

#[tauri::command]
pub fn parse_backend_version(version_string: String) -> u32 {
    // Remove any leading non-digit characters
    let numeric = version_string.trim_start_matches(|c: char| !c.is_ascii_digit());
    numeric.parse::<u32>().unwrap_or(0)
}

#[tauri::command]
pub async fn check_backend_for_updates(
    current_backend_string: String,
    version_backends: Vec<BackendInfo>,
) -> Result<UpdateCheckResult, String> {
    let parts: Vec<&str> = current_backend_string.split('/').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid current backend format: {}",
            current_backend_string
        ));
    }

    let current_version = parts[0];
    let current_backend = parts[1];

    // Get the effective/migrated backend type
    let current_effective_backend_type = map_old_backend_to_new(current_backend.to_string());

    // Find the latest version for the current backend type
    let target_backend_string =
        find_latest_version_for_backend(version_backends, current_effective_backend_type.clone());

    if target_backend_string.is_none() {
        log::warn!(
            "No available versions found for current backend type: {}",
            current_effective_backend_type
        );
        return Ok(UpdateCheckResult {
            update_needed: false,
            new_version: "0".to_string(),
            target_backend: None,
        });
    }

    let target_backend_string = target_backend_string.unwrap();
    let target_parts: Vec<&str> = target_backend_string.split('/').collect();
    let latest_version = target_parts[0];

    // Check if update is needed
    if parse_backend_version(latest_version.to_string())
        > parse_backend_version(current_version.to_string())
    {
        log::info!(
            "New update available: {} -> {}",
            latest_version,
            target_backend_string
        );
        Ok(UpdateCheckResult {
            update_needed: true,
            new_version: latest_version.to_string(),
            target_backend: Some(target_backend_string),
        })
    } else {
        log::info!(
            "Already at latest version: {} = {}",
            current_version,
            latest_version
        );
        Ok(UpdateCheckResult {
            update_needed: false,
            new_version: "0".to_string(),
            target_backend: None,
        })
    }
}

#[tauri::command]
pub async fn remove_old_backend_versions(
    backends_dir: String,
    latest_version: String,
    backend_type: String,
) -> Result<Vec<String>, String> {
    let mut removed_paths = Vec::new();
    let backends_path = PathBuf::from(&backends_dir);

    if !backends_path.exists() {
        return Ok(removed_paths);
    }

    let version_dirs = fs::read_dir(&backends_path)
        .map_err(|e| format!("Failed to read backends directory: {}", e))?;

    for version_entry in version_dirs {
        let version_entry =
            version_entry.map_err(|e| format!("Failed to read version entry: {}", e))?;

        let version_path = version_entry.path();
        let version_name = match version_path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };

        // Skip the latest version
        if version_name == latest_version {
            continue;
        }

        // Check if this version has the specific backend type
        let backend_type_path = version_path.join(&backend_type);

        if backend_type_path.exists() {
            // Verify it's actually installed before removing
            if is_backend_installed(&backend_type_path) {
                match fs::remove_dir_all(&backend_type_path) {
                    Ok(_) => {
                        log::info!(
                            "Removed old version of {}: {}",
                            backend_type,
                            backend_type_path.display()
                        );
                        removed_paths.push(backend_type_path.to_string_lossy().to_string());
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to remove old backend version: {} - {}",
                            backend_type_path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    Ok(removed_paths)
}

#[tauri::command]
pub fn validate_backend_string(backend_string: String) -> Result<(String, String), String> {
    let parts: Vec<&str> = backend_string.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid backend format: {}", backend_string));
    }

    let version = parts[0].trim();
    let backend = parts[1].trim();

    if version.is_empty() || backend.is_empty() {
        return Err(format!("Invalid backend format: {}", backend_string));
    }

    Ok((version.to_string(), backend.to_string()))
}

#[tauri::command]
pub fn should_migrate_backend(
    stored_backend_type: String,
    version_backends: Vec<BackendInfo>,
) -> Result<Option<String>, String> {
    let mapped_new_backend_type = map_old_backend_to_new(stored_backend_type.clone());
    let is_migration_needed = mapped_new_backend_type != stored_backend_type;

    if !is_migration_needed {
        return Ok(None);
    }

    // Check if the new, mapped backend is available
    let is_new_type_available = version_backends
        .iter()
        .any(|vb| map_old_backend_to_new(vb.backend.clone()) == mapped_new_backend_type);

    if is_new_type_available {
        log::info!(
            "Migration needed from '{}' to '{}'",
            stored_backend_type,
            mapped_new_backend_type
        );
        Ok(Some(mapped_new_backend_type))
    } else {
        log::warn!(
            "Migration from '{}' to '{}' skipped: New type not available",
            stored_backend_type,
            mapped_new_backend_type
        );
        Ok(None)
    }
}

// ============================================================================
// Backend Path & Installation Commands
// ============================================================================

#[tauri::command]
pub fn get_backend_dir(backend: String, version: String, jan_data_folder: String) -> String {
    PathBuf::from(&jan_data_folder)
        .join("llamacpp")
        .join("backends")
        .join(&version)
        .join(&backend)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub fn get_backend_exe_path(
    backend: String,
    version: String,
    jan_data_folder: String,
    is_windows: bool,
) -> String {
    let backend_dir = PathBuf::from(get_backend_dir(backend, version, jan_data_folder));
    let exe_name = if is_windows {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    let build_path = backend_dir.join("build").join("bin").join(exe_name);
    if build_path.exists() {
        return build_path.to_string_lossy().to_string();
    }

    backend_dir.join(exe_name).to_string_lossy().to_string()
}

#[tauri::command]
pub fn check_backend_installed(
    backend: String,
    version: String,
    jan_data_folder: String,
    is_windows: bool,
) -> bool {
    let exe_path =
        PathBuf::from(get_backend_exe_path(backend, version, jan_data_folder, is_windows));
    exe_path.exists()
}

/// Result of a backend dependency tree verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct BackendVerificationResult {
    pub verified: bool,
    pub missing_libraries: Vec<String>,
    pub resolved_libraries: Vec<String>,
}

/// Windows API set DLLs (e.g. `api-ms-win-*`, `ext-ms-win-*`) are virtual —
/// they never exist as real files on disk and are resolved by the Windows
/// kernel at load time via an internal API set schema. lddtree records them
/// as not-found because static analysis cannot locate them, but they are not
/// genuinely missing and must not be reported as such.
fn is_virtual_windows_dll(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("api-ms-win-") || lower.starts_with("ext-ms-win-")
}

/// Returns true for files that are likely native binaries worth analyzing.
/// lddtree reads the file header to determine format, so this is just a
/// cheap pre-filter to skip obviously non-binary files.
fn looks_like_binary(path: &PathBuf) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        // Windows
        Some("exe") | Some("dll") => true,
        // macOS
        Some("dylib") => true,
        // Linux shared libs, including versioned names like libfoo.so.1.2
        Some(ext) if ext == "so" || ext.starts_with("so.") => true,
        // No extension: may be an ELF executable (llama-server on Linux/macOS)
        None => true,
        _ => false,
    }
}

/// Analyze a single binary and accumulate its missing/resolved libraries into
/// the provided sets. Silently skips files that are not valid binaries.
fn analyze_binary(
    path: &PathBuf,
    bin_dir: &PathBuf,
    missing: &mut std::collections::HashSet<String>,
    resolved: &mut std::collections::HashSet<String>,
) {
    use lddtree::DependencyAnalyzer;

    // Explicitly add the binary's directory as an extra search path.
    // - PE: lddtree already adds the app dir automatically, so this is a no-op on Windows.
    // - Mach-O: @loader_path / @executable_path rpaths are expanded automatically; this
    //   covers any lib that lacks an @rpath entry.
    // - ELF: $ORIGIN rpaths are expanded automatically, but some builds omit $ORIGIN and
    //   rely on LD_LIBRARY_PATH being set at launch. add_library_path is the static
    //   equivalent of running `LD_LIBRARY_PATH=<dir> ./llama-server`.
    let analyzer = DependencyAnalyzer::default().add_library_path(bin_dir.clone());

    let tree = match analyzer.analyze(path) {
        Ok(t) => t,
        Err(_) => return, // not a binary we can parse — skip silently
    };

    for (name, lib) in &tree.libraries {
        if lib.found() {
            resolved.insert(name.clone());
        } else if !is_virtual_windows_dll(name) {
            missing.insert(name.clone());
        }
    }
}

/// Walk every binary in `bin_dir` recursively and union their dependency trees.
/// Returns a `BackendVerificationResult` with all unresolved libraries across
/// the entire backend installation, not just the main executable.
fn verify_backend_dependencies(
    bin_dir: &PathBuf,
) -> Result<BackendVerificationResult, crate::error::LlamacppError> {
    if !bin_dir.exists() {
        return Err(crate::error::LlamacppError::new(
            crate::error::ErrorCode::BinaryNotFound,
            "Backend directory not found".into(),
            Some(bin_dir.to_string_lossy().to_string()),
        ));
    }

    let mut missing = std::collections::HashSet::new();
    let mut resolved = std::collections::HashSet::new();

    // Walk the directory recursively so nested layouts (build/bin/) are covered.
    let walker = walkdir::WalkDir::new(bin_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file());

    for entry in walker {
        let path = entry.path().to_path_buf();
        if looks_like_binary(&path) {
            analyze_binary(&path, bin_dir, &mut missing, &mut resolved);
        }
    }

    // A library may appear as resolved by one binary even if it is missing for
    // another. Only keep libraries that are genuinely unresolved everywhere.
    let truly_missing: Vec<String> = missing.difference(&resolved).cloned().collect();
    let mut truly_missing = truly_missing;
    let mut resolved_vec: Vec<String> = resolved.into_iter().collect();
    truly_missing.sort();
    resolved_vec.sort();

    Ok(BackendVerificationResult {
        verified: truly_missing.is_empty(),
        missing_libraries: truly_missing,
        resolved_libraries: resolved_vec,
    })
}

#[tauri::command]
pub fn verify_backend_installation(
    backend: String,
    version: String,
    jan_data_folder: String,
    is_windows: bool,
) -> Result<BackendVerificationResult, crate::error::LlamacppError> {
    let exe_path =
        PathBuf::from(get_backend_exe_path(backend.clone(), version.clone(), jan_data_folder.clone(), is_windows));
    if !exe_path.exists() {
        return Err(crate::error::LlamacppError::new(
            crate::error::ErrorCode::BinaryNotFound,
            "Backend executable not found".into(),
            Some(exe_path.to_string_lossy().to_string()),
        ));
    }
    // Scan from the backend root so all co-located DLLs/SOs are included.
    let backend_dir = PathBuf::from(get_backend_dir(backend, version, jan_data_folder));
    verify_backend_dependencies(&backend_dir)
}

// ============================================================================
// Remote Backend Fetching
// ============================================================================

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
}

#[tauri::command]
pub async fn fetch_remote_supported_backends(
    supported_backends: Vec<String>,
) -> Result<Vec<BackendInfo>, String> {
    let client = reqwest::Client::builder()
        .user_agent("jan-app")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let releases: Vec<GithubRelease> = {
        let primary = client
            .get("https://api.github.com/repos/janhq/llama.cpp/releases")
            .send()
            .await;

        match primary {
            Ok(resp) if resp.status().is_success() => resp
                .json::<Vec<GithubRelease>>()
                .await
                .map_err(|e| format!("Failed to parse GitHub releases JSON: {}", e))?,
            _ => {
                // Fallback to catalog mirror
                let fallback = client
                    .get("https://catalog.jan.ai/llama.cpp/releases/releases.json")
                    .send()
                    .await
                    .map_err(|e| format!("Both GitHub and fallback requests failed: {}", e))?;

                fallback
                    .json::<Vec<GithubRelease>>()
                    .await
                    .map_err(|e| format!("Failed to parse fallback releases JSON: {}", e))?
            }
        }
    };

    // Take the first 10 (already sorted descending by tag_name from GitHub)
    let mut result: Vec<BackendInfo> = Vec::new();
    let mut sorted_releases = releases;
    sorted_releases.sort_by(|a, b| b.tag_name.cmp(&a.tag_name));

    for release in sorted_releases.into_iter().take(10) {
        let version = &release.tag_name;
        for asset in &release.assets {
            // Expected format: llama-{version}-bin-{backend}.tar.gz
            let prefix = format!("llama-{}-bin-", version);
            let suffix = ".tar.gz";
            if asset.name.starts_with(&prefix) && asset.name.ends_with(suffix) {
                let backend = asset.name[prefix.len()..asset.name.len() - suffix.len()].to_string();
                let mapped = map_old_backend_to_new(backend.clone());
                if supported_backends.contains(&backend) || supported_backends.contains(&mapped) {
                    result.push(BackendInfo {
                        version: version.clone(),
                        backend,
                    });
                }
            }
        }
    }

    Ok(result)
}

// ============================================================================
// Backend Download Item Builder
// ============================================================================

#[derive(Serialize, Deserialize)]
pub struct BackendDownloadItem {
    pub url: String,
    pub save_path: String,
    pub model_id: String,
}

/// Internal helper: check if a CUDA runtime library is present at the new
/// location (`backend_dir/build/bin/{libname}`) without performing any
/// migration side-effects.
fn check_cuda_installed_internal(backend_dir: &str, cuda_version: &str, os_type: &str) -> bool {
    let libname: &str = match (os_type, cuda_version) {
        ("windows", "11.7") => "cudart64_110.dll",
        ("windows", "12.0") => "cudart64_12.dll",
        ("windows", "13.0") => "cudart64_13.dll",
        ("linux", "11.7") => "libcudart.so.11.0",
        ("linux", "12.0") => "libcudart.so.12",
        ("linux", "13.0") => "libcudart.so.13",
        _ => return false,
    };

    PathBuf::from(backend_dir)
        .join("build")
        .join("bin")
        .join(libname)
        .exists()
}

#[tauri::command]
pub fn build_backend_download_items(
    backend: String,
    version: String,
    source: String,
    jan_data_folder: String,
    os_type: String,
) -> Result<Vec<BackendDownloadItem>, String> {
    let backend_dir = get_backend_dir(backend.clone(), version.clone(), jan_data_folder.clone());
    let task_id = format!("llamacpp-{}-{}", version, backend).replace('.', "-");
    let platform_name = if os_type == "windows" { "win" } else { "linux" };

    // Base URL for the main backend archive
    let backend_url = match source.as_str() {
        "github" => format!(
            "https://github.com/janhq/llama.cpp/releases/download/{}/llama-{}-bin-{}.tar.gz",
            version, version, backend
        ),
        _ => format!(
            "https://catalog.jan.ai/llama.cpp/releases/{}/llama-{}-bin-{}.tar.gz",
            version, version, backend
        ),
    };

    let save_path = format!("{}/backend.tar.gz", backend_dir);

    let mut items = vec![BackendDownloadItem {
        url: backend_url,
        save_path,
        model_id: task_id.clone(),
    }];

    // CUDA runtime items
    if backend.contains("cu11.7") || backend.contains("cuda-11") {
        let already_installed =
            check_cuda_installed_internal(&backend_dir, "11.7", &os_type);
        if !already_installed {
            let cuda_url = match source.as_str() {
                "github" => format!(
                    "https://github.com/janhq/llama.cpp/releases/download/{}/cudart-llama-bin-{}-cu11.7-x64.tar.gz",
                    version, platform_name
                ),
                _ => format!(
                    "https://catalog.jan.ai/llama.cpp/releases/{}/cudart-llama-bin-{}-cu11.7-x64.tar.gz",
                    version, platform_name
                ),
            };
            items.push(BackendDownloadItem {
                url: cuda_url,
                save_path: format!("{}/build/bin/cuda11.tar.gz", backend_dir),
                model_id: task_id.clone(),
            });
        }
    } else if backend.contains("cu12.0") || backend.contains("cuda-12") {
        let already_installed =
            check_cuda_installed_internal(&backend_dir, "12.0", &os_type);
        if !already_installed {
            let cuda_url = match source.as_str() {
                "github" => format!(
                    "https://github.com/janhq/llama.cpp/releases/download/{}/cudart-llama-bin-{}-cu12.0-x64.tar.gz",
                    version, platform_name
                ),
                _ => format!(
                    "https://catalog.jan.ai/llama.cpp/releases/{}/cudart-llama-bin-{}-cu12.0-x64.tar.gz",
                    version, platform_name
                ),
            };
            items.push(BackendDownloadItem {
                url: cuda_url,
                save_path: format!("{}/build/bin/cuda12.tar.gz", backend_dir),
                model_id: task_id.clone(),
            });
        }
    } else if backend.contains("cuda-13") {
        let already_installed =
            check_cuda_installed_internal(&backend_dir, "13.0", &os_type);
        if !already_installed {
            let cuda_url = match source.as_str() {
                "github" => format!(
                    "https://github.com/janhq/llama.cpp/releases/download/{}/cudart-llama-bin-{}-cu13.0-x64.tar.gz",
                    version, platform_name
                ),
                _ => format!(
                    "https://catalog.jan.ai/llama.cpp/releases/{}/cudart-llama-bin-{}-cu13.0-x64.tar.gz",
                    version, platform_name
                ),
            };
            items.push(BackendDownloadItem {
                url: cuda_url,
                save_path: format!("{}/build/bin/cuda13.tar.gz", backend_dir),
                model_id: task_id.clone(),
            });
        }
    }

    Ok(items)
}

// ============================================================================
// Settings Update Handler
// ============================================================================

#[derive(Serialize, Deserialize, Debug)]
pub struct SettingUpdateResult {
    pub backend_type_updated: bool,
    pub effective_backend_type: Option<String>,
    pub needs_backend_installation: bool,
    pub version: Option<String>,
    pub backend: Option<String>,
}

#[tauri::command]
pub fn handle_setting_update(
    key: String,
    value: String,
    current_stored_backend: Option<String>,
) -> Result<SettingUpdateResult, String> {
    if key != "version_backend" {
        // For non-backend settings, return a simple result
        return Ok(SettingUpdateResult {
            backend_type_updated: false,
            effective_backend_type: None,
            needs_backend_installation: false,
            version: None,
            backend: None,
        });
    }

    // Handle version_backend update
    let parts: Vec<&str> = value.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid backend format: {}", value));
    }

    let version = parts[0].to_string();
    let backend = parts[1].to_string();

    if version.is_empty() || backend.is_empty() {
        return Err(format!("Invalid backend format: {}", value));
    }

    // Get the effective/migrated backend type
    let effective_backend_type = map_old_backend_to_new(backend.clone());

    // Check if backend type changed
    let backend_type_updated = match current_stored_backend {
        Some(stored) => stored != effective_backend_type,
        None => true,
    };

    log::info!(
        "Setting update for version_backend: {}/{} (effective: {})",
        version,
        backend,
        effective_backend_type
    );

    Ok(SettingUpdateResult {
        backend_type_updated,
        effective_backend_type: Some(effective_backend_type),
        needs_backend_installation: true,
        version: Some(version),
        backend: Some(backend),
    })
}

// ---------------------------- Tests ------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    // --- Tests for map_old_backend_to_new ---

    #[test]
    fn test_map_old_backend_to_new_cuda() {
        // Linux CUDA 12
        assert_eq!(
            map_old_backend_to_new("linux-avx2-cuda-cu12.0-x64".to_string()),
            "linux-cuda-12-common_cpus-x64"
        );
        // Windows CUDA 11 (noavx)
        assert_eq!(
            map_old_backend_to_new("win-noavx-cuda-cu11.7-x64".to_string()),
            "win-cuda-11-common_cpus-x64"
        );
    }

    #[test]
    fn test_map_old_backend_to_new_vulkan() {
        // Linux Vulkan
        assert_eq!(
            map_old_backend_to_new("linux-vulkan-x64".to_string()),
            "linux-vulkan-common_cpus-x64"
        );
        // Already new format
        assert_eq!(
            map_old_backend_to_new("win-vulkan-common_cpus-x64".to_string()),
            "win-vulkan-common_cpus-x64"
        );
    }

    #[test]
    fn test_map_old_backend_to_new_cpu() {
        // AVX512 migration
        assert_eq!(
            map_old_backend_to_new("win-avx512-x64".to_string()),
            "win-common_cpus-x64"
        );
        // AVX2 migration
        assert_eq!(
            map_old_backend_to_new("linux-avx2-x64".to_string()),
            "linux-common_cpus-x64"
        );
    }

    #[test]
    fn test_map_old_backend_to_new_arch() {
        // ARM64 detection
        assert_eq!(
            map_old_backend_to_new("linux-arm64".to_string()),
            "linux-arm64" // Does not match specific migration patterns, returns original
        );
    }

    // --- Tests for compare_versions (Private helper) ---

    #[test]
    fn test_compare_versions() {
        assert_eq!(compare_versions("1.0", "2.0"), -1);
        assert_eq!(compare_versions("2.0", "1.0"), 1);
        assert_eq!(compare_versions("1.0", "1.0"), 0);
        assert_eq!(compare_versions("1.0.1", "1.0"), 1);
        assert_eq!(compare_versions("450.80.02", "450.80.02"), 0);
        assert_eq!(compare_versions("525.60.13", "450.80.02"), 1);
        assert_eq!(compare_versions("10", "2"), 1); // Numeric check, not string
    }

    // --- Tests for get_supported_features ---

    #[test]
    fn test_get_supported_features_cpu_only() {
        let gpus = vec![];
        let exts = vec!["avx".to_string(), "avx2".to_string()];

        let result = get_supported_features("linux".to_string(), exts, gpus).unwrap();

        assert!(result.avx);
        assert!(result.avx2);
        assert!(!result.avx512);
        assert!(!result.cuda11);
        assert!(!result.vulkan);
    }

    #[test]
    fn test_get_supported_features_cuda_linux() {
        // Driver 525.60.13 supports CUDA 12 on Linux
        let gpus = vec![GpuInfo {
            driver_version: "530.00".to_string(),
            nvidia_info: Some(NvidiaInfo {
                compute_capability: "8.0".to_string(),
            }),
            vulkan_info: None,
        }];

        let result = get_supported_features("linux".to_string(), vec![], gpus).unwrap();

        assert!(result.cuda11); // 530 > 450
        assert!(result.cuda12); // 530 > 525
        assert!(!result.cuda13); // 530 < 580
    }

    #[test]
    fn test_get_supported_features_vulkan() {
        let gpus = vec![GpuInfo {
            driver_version: "0.0".to_string(),
            nvidia_info: None,
            vulkan_info: Some(VulkanInfo {
                api_version: "1.3".to_string(),
            }),
        }];

        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();

        assert!(result.vulkan);
        assert!(!result.cuda11);
    }

    // --- Tests for determine_supported_backends ---

    #[test]
    fn test_determine_supported_backends_windows_all() {
        let features = SystemFeatures {
            cuda11: true,
            cuda12: true,
            cuda13: false,
            vulkan: true,
        };

        let result =
            determine_supported_backends("windows".to_string(), "x86_64".to_string(), features)
                .unwrap();

        assert!(result.contains(&"win-common_cpus-x64".to_string()));
        assert!(result.contains(&"win-cuda-11-common_cpus-x64".to_string()));
        assert!(result.contains(&"win-cuda-12-common_cpus-x64".to_string()));
        assert!(result.contains(&"win-vulkan-common_cpus-x64".to_string()));
        assert!(!result.contains(&"win-cuda-13-common_cpus-x64".to_string()));
    }

    #[test]
    fn test_determine_supported_backends_mac_arm() {
        let features = SystemFeatures {
            cuda11: false,
            cuda12: false,
            cuda13: false,
            vulkan: false,
        };

        let result =
            determine_supported_backends("macos".to_string(), "arm64".to_string(), features)
                .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "macos-arm64");
    }

    // --- Tests for list_supported_backends ---

    #[tokio::test]
    async fn test_list_supported_backends_sorting_and_dedup() {
        let remote = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "backend-a".into(),
            },
            BackendInfo {
                version: "b7523".into(),
                backend: "backend-b".into(),
            },
        ];

        let local = vec![
            // Should override remote
            BackendInfo {
                version: "b7523".into(),
                backend: "backend-a".into(),
            },
            // Newer version
            BackendInfo {
                version: "b7524".into(),
                backend: "backend-c".into(),
            },
        ];

        let result = list_supported_backends(remote, local).await.unwrap();

        // Expect 3 items: b7524(c), b7523(a), b7523(b)
        assert_eq!(result.len(), 3);

        // Check sorting: Version desc (b7524 > b7523)
        assert_eq!(result[0].version, "b7524");
        assert_eq!(result[1].version, "b7523");
        assert_eq!(result[2].version, "b7523");

        // Check sorting: Backend asc for same version
        // backend-a comes before backend-b
        assert_eq!(result[1].backend, "backend-a");
        assert_eq!(result[2].backend, "backend-b");
    }

    // --- Tests for parse_backend_version ---
    #[test]
    fn test_parse_backend_version() {
        assert_eq!(parse_backend_version("b7523".to_string()), 7523);
        assert_eq!(parse_backend_version("b7524".to_string()), 7524);
        assert_eq!(parse_backend_version("7525".to_string()), 7525);
        assert_eq!(parse_backend_version("v100".to_string()), 100);
        assert_eq!(parse_backend_version("invalid".to_string()), 0);
        // Note: "v1.0.0" would fail to parse as u32 due to dots, returning 0
        assert_eq!(parse_backend_version("v1.0.0".to_string()), 0);
    }
    // --- Filesystem Integration Tests ---

    #[tokio::test]
    async fn test_get_local_installed_backends() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // Structure:
        // root/
        //   b7523/
        //     backend-a/
        //       build/bin/llama-server (exe)
        //     backend-empty/ (no exe)

        let v1_path = root.join("b7523");
        let backend_a = v1_path.join("backend-a");
        let backend_empty = v1_path.join("backend-empty");

        fs::create_dir_all(&backend_a.join("build").join("bin")).unwrap();
        fs::create_dir_all(&backend_empty).unwrap();

        // Create mock executable
        let exe_name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        File::create(backend_a.join("build").join("bin").join(exe_name)).unwrap();

        let result = get_local_installed_backends(root.to_string_lossy().to_string())
            .await
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].version, "b7523");
        assert_eq!(result[0].backend, "backend-a");
    }

    #[tokio::test]
    async fn test_is_cuda_installed_migration() {
        let backend_dir = tempfile::tempdir().unwrap();
        let jan_data_dir = tempfile::tempdir().unwrap();

        let version = "12.0";
        let os_type = "linux"; // Maps to libcudart.so.12

        // Setup Old Path: jan_data/llamacpp/lib/libcudart.so.12
        let old_lib_dir = jan_data_dir.path().join("llamacpp").join("lib");
        fs::create_dir_all(&old_lib_dir).unwrap();
        let lib_name = "libcudart.so.12";
        let old_file_path = old_lib_dir.join(lib_name);
        {
            let mut f = File::create(&old_file_path).unwrap();
            f.write_all(b"dummy content").unwrap();
        }

        // Run Check (should trigger migration)
        let installed = is_cuda_installed(
            backend_dir.path().to_string_lossy().to_string(),
            version.to_string(),
            os_type.to_string(),
            jan_data_dir.path().to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        assert!(installed, "Should return true after migration");

        // Verify Migration
        let new_path = backend_dir.path().join("build").join("bin").join(lib_name);
        assert!(new_path.exists(), "File should exist in new location");
        assert!(
            !old_file_path.exists(),
            "File should be removed from old location"
        );
    }

    #[tokio::test]
    async fn test_is_cuda_installed_already_exists() {
        let backend_dir = tempfile::tempdir().unwrap();
        let jan_data_dir = tempfile::tempdir().unwrap(); // Empty

        let version = "11.7";
        let os_type = "windows"; // Maps to cudart64_110.dll
        let lib_name = "cudart64_110.dll";

        // Setup New Path directly
        let target_dir = backend_dir.path().join("build").join("bin");
        fs::create_dir_all(&target_dir).unwrap();
        File::create(target_dir.join(lib_name)).unwrap();

        let installed = is_cuda_installed(
            backend_dir.path().to_string_lossy().to_string(),
            version.to_string(),
            os_type.to_string(),
            jan_data_dir.path().to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        assert!(installed);
    }

    // --- Tests for find_latest_version_for_backend ---

    #[test]
    fn test_find_latest_version_for_backend() {
        let backends = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "linux-common_cpus-x64".into(),
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(),
            },
            BackendInfo {
                version: "b7522".into(),
                backend: "linux-common_cpus-x64".into(),
            },
        ];

        let result = find_latest_version_for_backend(backends, "linux-common_cpus-x64".to_string());
        assert_eq!(result, Some("b7524/linux-common_cpus-x64".to_string()));
    }

    #[test]
    fn test_find_latest_version_for_backend_with_migration() {
        let backends = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "linux-avx2-x64".into(), // Old format
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(), // New format
            },
        ];

        // Both should map to linux-common_cpus-x64
        let result = find_latest_version_for_backend(backends, "linux-common_cpus-x64".to_string());
        assert_eq!(result, Some("b7524/linux-common_cpus-x64".to_string()));
    }

    // --- Tests for check_backend_for_updates ---

    #[tokio::test]
    async fn test_check_backend_for_updates_needs_update() {
        let current = "b7523/linux-common_cpus-x64".to_string();
        let available = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "linux-common_cpus-x64".into(),
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(),
            },
        ];

        let result = check_backend_for_updates(current, available).await.unwrap();

        assert!(result.update_needed);
        assert_eq!(result.new_version, "b7524");
        assert_eq!(
            result.target_backend,
            Some("b7524/linux-common_cpus-x64".to_string())
        );
    }

    #[tokio::test]
    async fn test_check_backend_for_updates_already_latest() {
        let current = "b7524/linux-common_cpus-x64".to_string();
        let available = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "linux-common_cpus-x64".into(),
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(),
            },
        ];

        let result = check_backend_for_updates(current, available).await.unwrap();

        assert!(!result.update_needed);
        assert_eq!(result.new_version, "0");
        assert_eq!(result.target_backend, None);
    }

    // --- Tests for validate_backend_string ---

    #[test]
    fn test_validate_backend_string_valid() {
        let result = validate_backend_string("b7524/linux-common_cpus-x64".to_string()).unwrap();
        assert_eq!(result.0, "b7524");
        assert_eq!(result.1, "linux-common_cpus-x64");
    }

    #[test]
    fn test_validate_backend_string_invalid() {
        let result = validate_backend_string("invalid-format".to_string());
        assert!(result.is_err());
    }

    // --- Tests for should_migrate_backend ---

    #[test]
    fn test_should_migrate_backend_needs_migration() {
        let old_backend = "linux-avx2-x64".to_string();
        let available = vec![BackendInfo {
            version: "b7524".into(),
            backend: "linux-common_cpus-x64".into(),
        }];

        let result = should_migrate_backend(old_backend, available).unwrap();
        assert_eq!(result, Some("linux-common_cpus-x64".to_string()));
    }

    #[test]
    fn test_should_migrate_backend_no_migration_needed() {
        let new_backend = "linux-common_cpus-x64".to_string();
        let available = vec![BackendInfo {
            version: "b7524".into(),
            backend: "linux-common_cpus-x64".into(),
        }];

        let result = should_migrate_backend(new_backend, available).unwrap();
        assert_eq!(result, None);
    }

    // -------------------------------------------------------------------------
    // Tests for get_backend_dir
    // -------------------------------------------------------------------------

    #[test]
    fn test_get_backend_dir_path_format() {
        let result = get_backend_dir(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "/home/user/.jan".to_string(),
        );
        assert!(result.contains("llamacpp"));
        assert!(result.contains("backends"));
        assert!(result.contains("b7523"));
        assert!(result.contains("linux-common_cpus-x64"));
        // Ensure the segments are in the right order
        let path = PathBuf::from(&result);
        let components: Vec<_> = path.components().collect();
        let names: Vec<String> = components
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect();
        let llamacpp_idx = names.iter().position(|n| n == "llamacpp").unwrap();
        let backends_idx = names.iter().position(|n| n == "backends").unwrap();
        let version_idx = names.iter().position(|n| n == "b7523").unwrap();
        let backend_idx = names.iter().position(|n| n == "linux-common_cpus-x64").unwrap();
        assert!(llamacpp_idx < backends_idx);
        assert!(backends_idx < version_idx);
        assert!(version_idx < backend_idx);
    }

    // -------------------------------------------------------------------------
    // Tests for get_backend_exe_path
    // -------------------------------------------------------------------------

    #[test]
    fn test_get_backend_exe_path_no_build_dir_linux() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let result = get_backend_exe_path(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data.clone(),
            false,
        );
        // Should fall back to root dir (build dir doesn't exist)
        assert!(result.ends_with("llama-server"));
        assert!(!result.ends_with("llama-server.exe"));
    }

    #[test]
    fn test_get_backend_exe_path_no_build_dir_windows() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let result = get_backend_exe_path(
            "win-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            true,
        );
        assert!(result.ends_with("llama-server.exe"));
    }

    #[test]
    fn test_get_backend_exe_path_with_build_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        // Create the build/bin directory and place the exe there
        let backend_dir = PathBuf::from(&jan_data)
            .join("llamacpp")
            .join("backends")
            .join("b7523")
            .join("linux-common_cpus-x64");
        let build_bin = backend_dir.join("build").join("bin");
        fs::create_dir_all(&build_bin).unwrap();
        File::create(build_bin.join("llama-server")).unwrap();

        let result = get_backend_exe_path(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            false,
        );
        assert!(result.contains("build"));
        assert!(result.contains("bin"));
        assert!(result.ends_with("llama-server"));
    }

    // -------------------------------------------------------------------------
    // Tests for check_backend_installed
    // -------------------------------------------------------------------------

    #[test]
    fn test_check_backend_installed_true() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let backend_dir = PathBuf::from(&jan_data)
            .join("llamacpp")
            .join("backends")
            .join("b7523")
            .join("linux-common_cpus-x64");
        fs::create_dir_all(&backend_dir).unwrap();
        File::create(backend_dir.join("llama-server")).unwrap();

        let result = check_backend_installed(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            false,
        );
        assert!(result);
    }

    #[test]
    fn test_check_backend_installed_false_when_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let result = check_backend_installed(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            false,
        );
        assert!(!result);
    }

    // -------------------------------------------------------------------------
    // Tests for verify_backend_installation
    // -------------------------------------------------------------------------

    #[test]
    fn test_verify_backend_installation_returns_err_when_exe_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let result = verify_backend_installation(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            false,
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::BinaryNotFound));
    }

    #[test]
    fn test_verify_backend_dependencies_returns_err_on_missing_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let nonexistent = temp_dir.path().join("does-not-exist");

        let result = verify_backend_dependencies(&nonexistent);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::BinaryNotFound));
    }

    #[test]
    fn test_verify_backend_dependencies_skips_unparseable_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        // An unparseable file in the dir should be silently skipped, not error.
        fs::write(temp_dir.path().join("llama-server"), b"not a real binary").unwrap();
        fs::write(temp_dir.path().join("libggml.so"), b"not a real binary").unwrap();

        let result = verify_backend_dependencies(&temp_dir.path().to_path_buf());

        // Succeeds with an empty result — nothing parseable, nothing missing.
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.verified);
        assert!(r.missing_libraries.is_empty());
    }

    #[test]
    fn test_verify_backend_installation_scans_whole_backend_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        // Create the backend dir with a stub exe and a stub DLL beside it.
        let backend_dir = PathBuf::from(&jan_data)
            .join("llamacpp")
            .join("backends")
            .join("b7523")
            .join("linux-common_cpus-x64");
        fs::create_dir_all(&backend_dir).unwrap();
        fs::write(backend_dir.join("llama-server"), b"not a real binary").unwrap();
        fs::write(backend_dir.join("libggml.so"), b"not a real binary").unwrap();

        // Both files are unparseable stubs — verify_backend_installation must
        // return Ok (nothing missing) rather than Err, confirming it walks the
        // whole directory and skips non-binaries rather than hard-failing.
        let result = verify_backend_installation(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            jan_data,
            false,
        );
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.verified);
    }

    #[test]
    fn test_is_virtual_windows_dll() {
        assert!(is_virtual_windows_dll("api-ms-win-core-memory-l1-1-0.dll"));
        assert!(is_virtual_windows_dll("API-MS-WIN-CORE-LIBRARYLOADER-L1-2-0.DLL"));
        assert!(is_virtual_windows_dll("ext-ms-win-ntuser-draw-l1-1-0.dll"));
        assert!(!is_virtual_windows_dll("KERNEL32.dll"));
        assert!(!is_virtual_windows_dll("libcuda.so.1"));
        assert!(!is_virtual_windows_dll("libvulkan.so.1"));
    }

    // -------------------------------------------------------------------------
    // Tests for build_backend_download_items
    // -------------------------------------------------------------------------

    #[test]
    fn test_build_backend_download_items_non_cuda_returns_one_item() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let items = build_backend_download_items(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "github".to_string(),
            jan_data,
            "linux".to_string(),
        )
        .unwrap();

        assert_eq!(items.len(), 1);
        assert!(items[0].url.contains("linux-common_cpus-x64"));
        assert!(items[0].url.contains("github.com"));
    }

    #[test]
    fn test_build_backend_download_items_cuda12_returns_two_items() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let items = build_backend_download_items(
            "linux-cuda-12-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "github".to_string(),
            jan_data,
            "linux".to_string(),
        )
        .unwrap();

        assert_eq!(items.len(), 2);
        assert!(items[1].url.contains("cu12.0"));
        assert!(items[1].save_path.ends_with("cuda12.tar.gz"));
        // All items must share the same model_id for unified progress tracking
        assert_eq!(items[0].model_id, items[1].model_id);
    }

    #[test]
    fn test_build_backend_download_items_cu11_returns_two_items() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let items = build_backend_download_items(
            "linux-cu11.7-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "cdn".to_string(),
            jan_data,
            "linux".to_string(),
        )
        .unwrap();

        assert_eq!(items.len(), 2);
        assert!(items[1].url.contains("cu11.7"));
        assert!(items[1].save_path.ends_with("cuda11.tar.gz"));
        // All items must share the same model_id for unified progress tracking
        assert_eq!(items[0].model_id, items[1].model_id);
    }

    #[test]
    fn test_build_backend_download_items_github_vs_cdn_urls() {
        let temp_dir = tempfile::tempdir().unwrap();
        let jan_data = temp_dir.path().to_string_lossy().to_string();

        let github_items = build_backend_download_items(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "github".to_string(),
            jan_data.clone(),
            "linux".to_string(),
        )
        .unwrap();

        let cdn_items = build_backend_download_items(
            "linux-common_cpus-x64".to_string(),
            "b7523".to_string(),
            "cdn".to_string(),
            jan_data,
            "linux".to_string(),
        )
        .unwrap();

        assert!(github_items[0].url.contains("github.com"));
        assert!(cdn_items[0].url.contains("catalog.jan.ai"));
        assert_ne!(github_items[0].url, cdn_items[0].url);
    }
}
