use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

#[tauri::command]
pub fn map_old_backend_to_new(old_backend: String) -> String {
    // Upstream provider serves two platforms with different naming streams:
    //   - macOS keeps the existing `macos-{arm64,x64}` ggml-org tarball names.
    //   - Windows uses ggml-org native zip names: `win-cpu-x64`,
    //     `win-cuda-12.4-x64`, `win-cuda-13.1-x64`, `win-vulkan-x64`.
    //
    // This function exists mainly for legacy janhq-mirror entries that may
    // have been persisted in user settings before the Windows switch to
    // upstream. It maps any historical Windows backend id to its closest
    // ggml-org equivalent so old settings still resolve to something we can
    // actually download.
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
    let arch = if is_x64 { "x64" } else { arch_suffix };

    // Windows ggml-org native names: already correct, return as-is.
    if is_windows
        && (old_backend == "win-cpu-x64"
            || old_backend.contains("cuda-12.4")
            || old_backend.contains("cuda-13.1")
            || old_backend == "win-vulkan-x64")
    {
        return old_backend;
    }

    // Legacy janhq Windows CUDA → nearest ggml-org tier. Two janhq naming
    // generations exist on disk in the wild:
    //   - `win-cuda-{11,12,13}-common_cpus-x64` (contains `cuda-{11,12,13}`)
    //   - `win-noavx-cuda-cu{11.7,12.0,13.0}-x64` (contains `cu{11,12,13}`)
    // Match both, mapping each to its closest ggml-org tier.
    if is_windows && (old_backend.contains("cuda-13") || old_backend.contains("cu13")) {
        return format!("win-cuda-13.1-{}", arch);
    }
    if is_windows && (old_backend.contains("cuda-12") || old_backend.contains("cu12")) {
        return format!("win-cuda-12.4-{}", arch);
    }
    // CUDA 11 is dropped on ggml-org — surface as CUDA 12.4 (the lowest tier
    // ggml-org ships). Driver detection in `get_supported_features` will
    // refuse to enable it on machines whose drivers are too old.
    if is_windows && (old_backend.contains("cuda-11") || old_backend.contains("cu11")) {
        return format!("win-cuda-12.4-{}", arch);
    }
    if is_windows && old_backend.contains("vulkan") {
        return format!("win-vulkan-{}", arch);
    }
    if is_windows
        && (old_backend.contains("common_cpus")
            || old_backend.contains("avx512")
            || old_backend.contains("avx2")
            || old_backend.contains("avx-x64")
            || old_backend.contains("noavx-x64"))
    {
        return format!("win-cpu-{}", arch);
    }

    // Linux legacy mappings — preserved verbatim for callers that still
    // pass the upstream plugin a janhq-mirror linux name. The upstream
    // extension is not used on Linux today, but keeping this path lets
    // unit tests stay valid and avoids surprises if it ever is.
    if old_backend.contains("cuda-cu12.0") {
        return format!("{}cuda-12-common_cpus-{}", os_prefix, arch);
    } else if old_backend.contains("cuda-cu11.7") {
        return format!("{}cuda-11-common_cpus-{}", os_prefix, arch);
    } else if old_backend.contains("vulkan") {
        if old_backend.contains("vulkan-common_cpus") {
            return old_backend;
        }
        return format!("{}vulkan-common_cpus-{}", os_prefix, arch);
    }

    let is_old_cpu_backend = old_backend.contains("avx512")
        || old_backend.contains("avx2")
        || old_backend.contains("avx-x64")
        || old_backend.contains("noavx-x64");

    if is_old_cpu_backend {
        return format!("{}common_cpus-{}", os_prefix, arch);
    }

    old_backend
}

#[tauri::command]
pub async fn get_local_installed_backends(
    backends_dir: String,
) -> Result<Vec<BackendInfo>, String> {
    let mut local: Vec<BackendInfo> = Vec::new();
    let backends_path = PathBuf::from(&backends_dir);

    if !backends_path.exists() {
        return Ok(local);
    }

    let version_dirs = fs::read_dir(&backends_path)
        .map_err(|e| format!("Failed to read backends directory: {}", e))?;

    for version_entry in version_dirs {
        let version_entry =
            version_entry.map_err(|e| format!("Failed to read version entry: {}", e))?;

        let version_path = version_entry.path();

        let metadata =
            fs::metadata(&version_path).map_err(|e| format!("Failed to get metadata: {}", e))?;

        if !metadata.is_dir() {
            continue;
        }

        let version_name = match version_path.file_name() {
            Some(name) => name.to_string_lossy().replace('\u{FEFF}', "").trim().to_string(),
            None => continue,
        };

        let backend_types = fs::read_dir(&version_path)
            .map_err(|e| format!("Failed to read version directory: {}", e))?;

        for backend_entry in backend_types {
            let backend_entry =
                backend_entry.map_err(|e| format!("Failed to read backend entry: {}", e))?;

            let backend_path = backend_entry.path();

            let backend_name = match backend_path.file_name() {
                Some(name) => name.to_string_lossy().replace('\u{FEFF}', "").trim().to_string(),
                None => continue,
            };

            if is_backend_installed(&backend_path) {
                let order = fs::metadata(&backend_path)
                    .and_then(|m| m.modified())
                    .map(|t| {
                        t.duration_since(std::time::SystemTime::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as u32
                    })
                    .unwrap_or(0);

                local.push(BackendInfo {
                    version: version_name.clone(),
                    backend: backend_name,
                    order,
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
    #[serde(default)]
    order: u32,
}

#[derive(Deserialize)]
pub struct SystemFeatures {
    // `cuda11` is kept in the wire format for backwards compatibility with
    // the shared TS `SystemFeatures` shape. Upstream / ggml-org dropped
    // CUDA 11 release artifacts (the lowest tier shipped is CUDA 12.4),
    // so the field is accepted but never expanded into a supported backend
    // on the upstream Windows matrix.
    #[allow(dead_code)]
    #[serde(default)]
    cuda11: bool,
    cuda12: bool,
    cuda13: bool,
    vulkan: bool,
}

#[derive(Serialize)]
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
            // ggml-org/llama.cpp Windows release naming. Asset ids follow
            // the pattern `llama-{tag}-bin-{backend}.zip` — these strings
            // are also the on-disk backend folder names.
            supported_backends.push("win-cpu-x64".to_string());
            if features.cuda12 {
                supported_backends.push("win-cuda-12.4-x64".to_string());
            }
            if features.cuda13 {
                supported_backends.push("win-cuda-13.1-x64".to_string());
            }
            if features.vulkan {
                supported_backends.push("win-vulkan-x64".to_string());
            }
        }
        "windows-aarch64" | "windows-arm64" => {
            supported_backends.push("win-cpu-arm64".to_string());
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

fn is_windows_backend(backend: &str) -> bool {
    backend.starts_with("win-")
}

fn compare_backend_versions_for_sort(left: &BackendInfo, right: &BackendInfo) -> std::cmp::Ordering {
    if is_windows_backend(&left.backend) && is_windows_backend(&right.backend) {
        let left_version = parse_backend_version(left.version.clone());
        let right_version = parse_backend_version(right.version.clone());
        let version_cmp = right_version.cmp(&left_version);
        if version_cmp != std::cmp::Ordering::Equal {
            return version_cmp;
        }
    }

    let order_cmp = right.order.cmp(&left.order);
    if order_cmp != std::cmp::Ordering::Equal {
        return order_cmp;
    }

    let version_cmp = right.version.cmp(&left.version);
    if version_cmp != std::cmp::Ordering::Equal {
        return version_cmp;
    }

    left.backend.cmp(&right.backend)
}

#[tauri::command]
pub async fn list_supported_backends(
    remote_backend_versions: Vec<BackendInfo>,
    local_backend_versions: Vec<BackendInfo>,
) -> Result<Vec<BackendInfo>, String> {
    for entry in &remote_backend_versions {
        log::info!(
            "[list_supported_backends] remote: {}/{} order={}",
            entry.version, entry.backend, entry.order
        );
    }

    let mut merged_map: HashMap<String, BackendInfo> = HashMap::new();

    for entry in remote_backend_versions {
        let key = format!("{}|{}", entry.version, entry.backend);
        merged_map.insert(key, entry);
    }

    for entry in local_backend_versions {
        let key = format!("{}|{}", entry.version, entry.backend);
        merged_map
            .entry(key)
            .and_modify(|existing| {
                if entry.order > existing.order {
                    *existing = entry.clone();
                }
            })
            .or_insert(entry);
    }

    let mut merged: Vec<BackendInfo> = merged_map.into_values().collect();

    merged.sort_by(compare_backend_versions_for_sort);

    for entry in &merged {
        log::info!(
            "[list_supported_backends] sorted: {}/{} order={}",
            entry.version, entry.backend, entry.order
        );
    }

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
    compute_capability: String,
}

#[derive(Deserialize)]
pub struct VulkanInfo {
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

    // https://docs.nvidia.com/deploy/cuda-compatibility/
    //
    // Windows thresholds were bumped when the upstream provider switched
    // from janhq mirror (CUDA 11.7 / 12.0 / 13.0) to ggml-org native
    // releases (CUDA 12.4 / 13.1) — see ADR 2026-05-22 "Windows ships only
    // `llamacpp-upstream`". Linux thresholds are kept aligned with the
    // primary turboquant plugin so the upstream plugin's Linux matrix
    // (currently unused) stays consistent.
    //
    // CUDA 13.1 Windows threshold: NVIDIA CUDA Toolkit 13.1 Release Notes
    // document driver >= 581.15 as the minimum. The previous value "581"
    // effectively meant ">= 581.00" — a 0.15 gap below the documented
    // floor that let through beta/pre-release 581.0x drivers. Bumped to
    // "581.15" to match the spec exactly.
    //
    // NOTE: this gate alone does NOT fix the empty `--list-devices`
    // symptom in AtomicBot-ai/Atomic-Chat#25 — that user's driver almost
    // certainly already satisfies 581.15 and the failure is in
    // `cuInit()` enumeration (Optimus / MUX-switch parked dGPU, missing
    // cudart placement, etc.). The runtime degradation handled by
    // `tierEnumeratesDevices` in
    // `extensions/llamacpp-upstream-extension/src/index.ts` is the
    // primary fix for that cohort; this threshold correction is for
    // documentation accuracy and the narrow 581.00-581.14 band.
    let (min_cuda11_driver, min_cuda12_driver, min_cuda13_driver) = match os_type.as_str() {
        "linux" => ("450.80.02", "525.60.13", "580"),
        "windows" => ("452.39", "551.61", "581.15"),
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
    // Define library name lookup table. ggml-org publishes Windows cudart
    // archives for CUDA 12.4 and 13.1 only; legacy CUDA 11 entries are
    // retained for callers that may still pass an old toolkit version.
    let mut libname_lookup: HashMap<String, &str> = HashMap::new();
    libname_lookup.insert("windows-11.7".to_string(), "cudart64_110.dll");
    libname_lookup.insert("windows-12.0".to_string(), "cudart64_12.dll");
    libname_lookup.insert("windows-12.4".to_string(), "cudart64_12.dll");
    libname_lookup.insert("windows-13.0".to_string(), "cudart64_13.dll");
    libname_lookup.insert("windows-13.1".to_string(), "cudart64_13.dll");
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

    matching_backends.sort_by(compare_backend_versions_for_sort);

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

    // Priority list based on GPU memory. The upstream provider sees
    // ggml-org native backend names on Windows (`cuda-cu13.1`,
    // `cuda-cu12.4`, `vulkan`, `cpu`) and janhq/macos-style names on the
    // older code paths (`cuda-cu12.0`, `common_cpus`). Both forms are
    // listed so `get_backend_category` matches work regardless of which
    // generation of backend ids ended up in the version_backends slice.
    let backend_priorities: Vec<&str> = if has_enough_gpu_memory {
        vec![
            "cuda-cu13.1",
            "cuda-cu13.0",
            "cuda-cu12.4",
            "cuda-cu12.0",
            "cuda-cu11.7",
            "vulkan",
            "common_cpus",
            "cpu",
            "avx512",
            "avx2",
            "avx",
            "noavx",
            "arm64",
            "x64",
        ]
    } else {
        vec![
            "cuda-cu13.1",
            "cuda-cu13.0",
            "cuda-cu12.4",
            "cuda-cu12.0",
            "cuda-cu11.7",
            "common_cpus",
            "cpu",
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
            let best = matching_backends
                .into_iter()
                .max_by(|left, right| compare_backend_versions_for_sort(right, left))
                .unwrap();
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
    // ggml-org native Windows names (matched before legacy janhq patterns
    // to avoid `cu13.1`/`cu12.4` falling through to the older categories):
    if backend_string.contains("cuda-13.1") {
        return Some("cuda-cu13.1".to_string());
    }
    if backend_string.contains("cuda-12.4") {
        return Some("cuda-cu12.4".to_string());
    }
    // Legacy janhq mirror / linux turboquant names.
    if backend_string.contains("cuda-13-common_cpus") || backend_string.contains("cu13.0") {
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
    // ggml-org native Windows CPU name `win-cpu-x64` (and arm64 variant).
    // Matched as a dedicated category before falling back to the legacy
    // common_cpus / micro-arch buckets.
    if backend_string == "win-cpu-x64"
        || backend_string == "win-cpu-arm64"
        || backend_string.starts_with("win-cpu-")
    {
        return Some("cpu".to_string());
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

    // Update is needed when the order-based latest target differs from current
    if target_backend_string != current_backend_string {
        log::info!(
            "New update available: {} -> {}",
            current_backend_string,
            target_backend_string
        );
        Ok(UpdateCheckResult {
            update_needed: true,
            new_version: latest_version.to_string(),
            target_backend: Some(target_backend_string),
        })
    } else {
        log::info!(
            "Already at latest version: {}",
            current_backend_string
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

    // Handle version_backend update — strip BOM that may persist in saved settings
    let clean_value = value.replace('\u{FEFF}', "");
    let parts: Vec<&str> = clean_value.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid backend format: {}", clean_value));
    }

    let version = parts[0].trim().to_string();
    let backend = parts[1].trim().to_string();

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

// ============================================================================
// Bundled Backend Installation
// ============================================================================

#[derive(Serialize, Deserialize, Debug)]
pub struct BundledBackendResult {
    pub installed: bool,
    pub backend_string: Option<String>,
    pub version: Option<String>,
    pub backend: Option<String>,
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("readdir {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!("copy {} → {}: {}", src_path.display(), dst_path.display(), e)
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn install_bundled_backend<R: Runtime>(
    app: tauri::AppHandle<R>,
    backends_dir: String,
) -> Result<BundledBackendResult, String> {
    let not_bundled = Ok(BundledBackendResult {
        installed: false,
        backend_string: None,
        version: None,
        backend: None,
    });

    let mut resource_dir: Option<PathBuf> = None;

    // Try Tauri resource resolution (works in production builds).
    // Upstream variant looks at resources/llamacpp-backend-upstream/ — the
    // sibling turboquant fork lives at resources/llamacpp-backend/.
    for candidate in &[
        "resources/llamacpp-backend-upstream",
        "llamacpp-backend-upstream",
    ] {
        if let Ok(p) = app.path().resolve(candidate, tauri::path::BaseDirectory::Resource) {
            log::info!("[install_bundled_backend] Trying resource path '{}' → {}", candidate, p.display());
            if p.join("version.txt").exists() {
                resource_dir = Some(p);
                break;
            }
        }
    }

    // Dev mode fallback: resources live in src-tauri/resources/ relative to plugin crate
    if resource_dir.is_none() {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../resources/llamacpp-backend-upstream");
        log::info!("[install_bundled_backend] Trying dev fallback → {}", dev_path.display());
        if dev_path.join("version.txt").exists() {
            resource_dir = Some(dev_path);
        }
    }

    let resource_dir = match resource_dir {
        Some(p) => p,
        None => {
            log::info!("[install_bundled_backend] No bundled backend found in any candidate path");
            return not_bundled;
        }
    };

    let version_file = resource_dir.join("version.txt");
    let backend_file = resource_dir.join("backend.txt");
    let build_dir = resource_dir.join("build");

    if !version_file.exists() || !backend_file.exists() || !build_dir.exists() {
        log::info!("[install_bundled_backend] Missing files at {}", resource_dir.display());
        return not_bundled;
    }

    let version = fs::read_to_string(&version_file)
        .map_err(|e| format!("read version.txt: {}", e))?
        .replace('\u{FEFF}', "")
        .trim()
        .to_string();
    let backend = fs::read_to_string(&backend_file)
        .map_err(|e| format!("read backend.txt: {}", e))?
        .replace('\u{FEFF}', "")
        .trim()
        .to_string();

    if version.is_empty() || backend.is_empty() {
        log::warn!("[install_bundled_backend] Empty version or backend in meta files");
        return not_bundled;
    }

    let target_dir = PathBuf::from(&backends_dir).join(&version).join(&backend);

    if is_backend_installed(&target_dir) {
        log::info!(
            "[install_bundled_backend] Bundled backend already installed: {}/{}",
            version, backend
        );
        return Ok(BundledBackendResult {
            installed: true,
            backend_string: Some(format!("{}/{}", version, backend)),
            version: Some(version),
            backend: Some(backend),
        });
    }

    log::info!(
        "[install_bundled_backend] Installing bundled backend {}/{} from {}",
        version, backend, resource_dir.display()
    );

    let target_build_dir = target_dir.join("build");
    copy_dir_recursive(&build_dir, &target_build_dir)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin_dir = target_build_dir.join("bin");
        if bin_dir.exists() {
            for entry in fs::read_dir(&bin_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                    let mut perms = fs::metadata(entry.path())
                        .map_err(|e| e.to_string())?
                        .permissions();
                    perms.set_mode(0o755);
                    fs::set_permissions(entry.path(), perms).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    log::info!(
        "[install_bundled_backend] Successfully installed bundled backend: {}/{}",
        version, backend
    );

    Ok(BundledBackendResult {
        installed: true,
        backend_string: Some(format!("{}/{}", version, backend)),
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
    use filetime;

    // --- Tests for map_old_backend_to_new ---

    #[test]
    fn test_map_old_backend_to_new_cuda() {
        // Linux CUDA 12 — preserved legacy path (upstream Linux unused).
        assert_eq!(
            map_old_backend_to_new("linux-avx2-cuda-cu12.0-x64".to_string()),
            "linux-cuda-12-common_cpus-x64"
        );
        // Legacy janhq-mirror Windows CUDA 11 → folded into ggml-org's
        // lowest CUDA tier (12.4) because ggml-org dropped CUDA 11 builds.
        // Driver checks in `get_supported_features` block enablement when
        // the host's NVIDIA driver is too old for CUDA 12.4.
        assert_eq!(
            map_old_backend_to_new("win-noavx-cuda-cu11.7-x64".to_string()),
            "win-cuda-12.4-x64"
        );
        // Legacy janhq CUDA 12 → ggml-org CUDA 12.4.
        assert_eq!(
            map_old_backend_to_new("win-cuda-12-common_cpus-x64".to_string()),
            "win-cuda-12.4-x64"
        );
        // Legacy janhq CUDA 13 → ggml-org CUDA 13.1.
        assert_eq!(
            map_old_backend_to_new("win-cuda-13-common_cpus-x64".to_string()),
            "win-cuda-13.1-x64"
        );
        // Already-new ggml-org names round-trip unchanged.
        assert_eq!(
            map_old_backend_to_new("win-cuda-12.4-x64".to_string()),
            "win-cuda-12.4-x64"
        );
        assert_eq!(
            map_old_backend_to_new("win-cuda-13.1-x64".to_string()),
            "win-cuda-13.1-x64"
        );
    }

    #[test]
    fn test_map_old_backend_to_new_vulkan() {
        // Linux Vulkan — legacy path (upstream Linux unused).
        assert_eq!(
            map_old_backend_to_new("linux-vulkan-x64".to_string()),
            "linux-vulkan-common_cpus-x64"
        );
        // Legacy janhq Windows Vulkan → ggml-org Windows Vulkan.
        assert_eq!(
            map_old_backend_to_new("win-vulkan-common_cpus-x64".to_string()),
            "win-vulkan-x64"
        );
        // Already-new format round-trip.
        assert_eq!(
            map_old_backend_to_new("win-vulkan-x64".to_string()),
            "win-vulkan-x64"
        );
    }

    #[test]
    fn test_map_old_backend_to_new_cpu() {
        // Legacy janhq Windows AVX-tier CPU id → ggml-org Windows CPU.
        assert_eq!(
            map_old_backend_to_new("win-avx512-x64".to_string()),
            "win-cpu-x64"
        );
        // Legacy janhq Windows common_cpus → ggml-org Windows CPU.
        assert_eq!(
            map_old_backend_to_new("win-common_cpus-x64".to_string()),
            "win-cpu-x64"
        );
        // Already-new ggml-org name.
        assert_eq!(
            map_old_backend_to_new("win-cpu-x64".to_string()),
            "win-cpu-x64"
        );
        // Linux AVX2 — legacy path.
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

    fn windows_nvidia_gpu(driver_version: &str) -> GpuInfo {
        GpuInfo {
            driver_version: driver_version.to_string(),
            nvidia_info: Some(NvidiaInfo {
                compute_capability: "8.9".to_string(),
            }),
            vulkan_info: None,
        }
    }

    #[test]
    fn test_windows_driver_581_14_does_not_enable_cuda13() {
        // Drivers below the documented 581.15 minimum for CUDA Toolkit 13.1
        // are gated out. 581.14 is one step below the floor — keeps the
        // narrow beta/pre-release band of 581.00–581.14 off the CUDA 13.1
        // path. CUDA 12.4 still enabled (>= 551.61).
        let gpus = vec![windows_nvidia_gpu("581.14")];
        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();
        assert!(result.cuda12, "581.14 must still satisfy CUDA 12.4 (>= 551.61)");
        assert!(
            !result.cuda13,
            "581.14 must NOT pass the CUDA 13.1 gate (below documented 581.15 minimum)"
        );
    }

    #[test]
    fn test_windows_driver_581_15_enables_cuda13() {
        // Exact boundary — NVIDIA CUDA Toolkit 13.1 Release Notes list
        // 581.15 as the minimum Windows driver. Both tiers enabled.
        let gpus = vec![windows_nvidia_gpu("581.15")];
        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();
        assert!(result.cuda12);
        assert!(
            result.cuda13,
            "581.15 is the documented minimum for CUDA Toolkit 13.1 on Windows"
        );
    }

    #[test]
    fn test_windows_driver_581_42_enables_cuda13() {
        // Typical "recent" driver in the wild — should enable CUDA 13.1.
        // This is the cohort behind AtomicBot-ai/Atomic-Chat#25 whose
        // RTX 4090 still sees an empty `--list-devices`; the cause is
        // NOT this gate (driver is fine) but `cuInit()` enumeration
        // failure handled by `tierEnumeratesDevices` runtime degrade.
        let gpus = vec![windows_nvidia_gpu("581.42")];
        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();
        assert!(result.cuda12);
        assert!(result.cuda13);
    }

    #[test]
    fn test_windows_driver_551_61_enables_cuda12_only() {
        let gpus = vec![windows_nvidia_gpu("551.61")];
        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();
        assert!(result.cuda12);
        assert!(!result.cuda13);
    }

    #[test]
    fn test_windows_driver_550_does_not_enable_any_cuda_tier() {
        // H7 cohort — drivers in 528–550 range previously had CUDA 12.0
        // via the janhq mirror, now have nothing CUDA after the upstream
        // switch. Documented behaviour; UI surfaces a banner in Fix 3.
        let gpus = vec![windows_nvidia_gpu("550.00")];
        let result = get_supported_features("windows".to_string(), vec![], gpus).unwrap();
        assert!(!result.cuda12);
        assert!(!result.cuda13);
    }

    // --- Tests for determine_supported_backends ---

    #[test]
    fn test_determine_supported_backends_windows_all() {
        // Upstream Windows uses ggml-org native release names; CUDA 11
        // is intentionally not in the supported set (ggml-org doesn't
        // publish a Windows CUDA 11 build).
        let features = SystemFeatures {
            cuda11: true, // accepted on wire, ignored on Windows
            cuda12: true,
            cuda13: false,
            vulkan: true,
        };

        let result =
            determine_supported_backends("windows".to_string(), "x86_64".to_string(), features)
                .unwrap();

        assert!(result.contains(&"win-cpu-x64".to_string()));
        assert!(result.contains(&"win-cuda-12.4-x64".to_string()));
        assert!(result.contains(&"win-vulkan-x64".to_string()));
        assert!(!result.contains(&"win-cuda-13.1-x64".to_string()));
        assert!(!result.iter().any(|b| b.contains("cuda-11")));
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
                order: 1,
            },
            BackendInfo {
                version: "b7523".into(),
                backend: "backend-b".into(),
                order: 1,
            },
        ];

        let local = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "backend-a".into(),
                order: 0,
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "backend-c".into(),
                order: 2,
            },
        ];

        let result = list_supported_backends(remote, local).await.unwrap();

        assert_eq!(result.len(), 3);

        // Sorted by order desc: b7524(order=2), then b7523 entries (order=1) by backend asc
        assert_eq!(result[0].version, "b7524");
        assert_eq!(result[1].version, "b7523");
        assert_eq!(result[2].version, "b7523");

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
        assert!(result[0].order > 0, "order should be set from directory mtime");
    }

    #[tokio::test]
    async fn test_get_local_installed_backends_order_by_mtime() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        let exe_name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };

        // Create older backend first
        let v_old = root.join("turboquant-macos-arm64-old");
        let backend_old = v_old.join("macos-arm64");
        fs::create_dir_all(&backend_old.join("build").join("bin")).unwrap();
        File::create(backend_old.join("build").join("bin").join(exe_name)).unwrap();

        // Set old mtime (1 second in the past)
        let old_time = std::time::SystemTime::now() - std::time::Duration::from_secs(2);
        filetime::set_file_mtime(
            &backend_old,
            filetime::FileTime::from_system_time(old_time),
        )
        .unwrap();

        // Create newer backend
        let v_new = root.join("turboquant-macos-arm64-new");
        let backend_new = v_new.join("macos-arm64");
        fs::create_dir_all(&backend_new.join("build").join("bin")).unwrap();
        File::create(backend_new.join("build").join("bin").join(exe_name)).unwrap();

        let result = get_local_installed_backends(root.to_string_lossy().to_string())
            .await
            .unwrap();

        assert_eq!(result.len(), 2);

        let old_entry = result.iter().find(|b| b.version == "turboquant-macos-arm64-old").unwrap();
        let new_entry = result.iter().find(|b| b.version == "turboquant-macos-arm64-new").unwrap();

        assert!(
            new_entry.order > old_entry.order,
            "Newer backend (order={}) should have higher order than older (order={})",
            new_entry.order, old_entry.order
        );
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
                order: 2,
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(),
                order: 3,
            },
            BackendInfo {
                version: "b7522".into(),
                backend: "linux-common_cpus-x64".into(),
                order: 1,
            },
        ];

        let result = find_latest_version_for_backend(backends, "linux-common_cpus-x64".to_string());
        assert_eq!(result, Some("b7524/linux-common_cpus-x64".to_string()));
    }

    #[test]
    fn test_find_latest_version_for_windows_backend_uses_version_not_order() {
        // Both fixture entries carry the ggml-org native Windows CUDA
        // backend name. `find_latest_version_for_backend` is expected to
        // be called with the already-normalised (ggml-org) name.
        let backends = vec![
            BackendInfo {
                version: "b7524".into(),
                backend: "win-cuda-12.4-x64".into(),
                order: 1_800_000_000,
            },
            BackendInfo {
                version: "b7525".into(),
                backend: "win-cuda-12.4-x64".into(),
                order: 0,
            },
        ];

        let result =
            find_latest_version_for_backend(backends, "win-cuda-12.4-x64".to_string());
        assert_eq!(result, Some("b7525/win-cuda-12.4-x64".to_string()));
    }

    #[test]
    fn test_find_latest_version_for_backend_with_migration() {
        let backends = vec![
            BackendInfo {
                version: "b7523".into(),
                backend: "linux-avx2-x64".into(),
                order: 1,
            },
            BackendInfo {
                version: "b7524".into(),
                backend: "linux-common_cpus-x64".into(),
                order: 2,
            },
        ];

        let result = find_latest_version_for_backend(backends, "linux-common_cpus-x64".to_string());
        assert_eq!(result, Some("b7524/linux-common_cpus-x64".to_string()));
    }

    // --- Tests for check_backend_for_updates ---

    #[tokio::test]
    async fn test_check_backend_for_updates_needs_update() {
        let current = "turboquant-macos-arm64-e3dad20/macos-arm64".to_string();
        let available = vec![
            BackendInfo {
                version: "turboquant-macos-arm64-e3dad20".into(),
                backend: "macos-arm64".into(),
                order: 1,
            },
            BackendInfo {
                version: "turboquant-macos-arm64-18a8ef1".into(),
                backend: "macos-arm64".into(),
                order: 2,
            },
        ];

        let result = check_backend_for_updates(current, available).await.unwrap();

        assert!(result.update_needed);
        assert_eq!(result.new_version, "turboquant-macos-arm64-18a8ef1");
        assert_eq!(
            result.target_backend,
            Some("turboquant-macos-arm64-18a8ef1/macos-arm64".to_string())
        );
    }

    #[tokio::test]
    async fn test_check_backend_for_updates_already_latest() {
        let current = "turboquant-macos-arm64-18a8ef1/macos-arm64".to_string();
        let available = vec![
            BackendInfo {
                version: "turboquant-macos-arm64-e3dad20".into(),
                backend: "macos-arm64".into(),
                order: 1,
            },
            BackendInfo {
                version: "turboquant-macos-arm64-18a8ef1".into(),
                backend: "macos-arm64".into(),
                order: 2,
            },
        ];

        let result = check_backend_for_updates(current, available).await.unwrap();

        assert!(!result.update_needed);
        assert_eq!(result.new_version, "0");
        assert_eq!(result.target_backend, None);
    }

    #[tokio::test]
    async fn test_check_backend_for_updates_windows_uses_version_not_order() {
        // Current and available use the ggml-org native Windows CUDA name.
        let current = "b7524/win-cuda-12.4-x64".to_string();
        let available = vec![
            BackendInfo {
                version: "b7524".into(),
                backend: "win-cuda-12.4-x64".into(),
                order: 1_800_000_000,
            },
            BackendInfo {
                version: "b7525".into(),
                backend: "win-cuda-12.4-x64".into(),
                order: 0,
            },
        ];

        let result = check_backend_for_updates(current, available).await.unwrap();

        assert!(result.update_needed);
        assert_eq!(result.new_version, "b7525");
        assert_eq!(
            result.target_backend,
            Some("b7525/win-cuda-12.4-x64".to_string())
        );
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
            order: 1,
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
            order: 1,
        }];

        let result = should_migrate_backend(new_backend, available).unwrap();
        assert_eq!(result, None);
    }
}
