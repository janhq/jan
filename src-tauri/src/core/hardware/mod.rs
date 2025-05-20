pub mod nvidia;
pub mod vulkan;

use std::sync::OnceLock;
use sysinfo::System;
use tauri::path::BaseDirectory;
use tauri::Manager;

static SYSTEM_STATIC_INFO: OnceLock<SystemStaticInfo> = OnceLock::new();

#[derive(Clone, serde::Serialize, Debug)]
struct CpuStaticInfo {
    name: String,
    core_count: usize,
    arch: String,
    extensions: Vec<String>,
}

impl CpuStaticInfo {
    fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_all();

        let name = system
            .cpus()
            .first()
            .map(|cpu| cpu.brand())
            .unwrap_or("unknown")
            .to_string();

        // cortex only returns amd64, arm64, or Unsupported
        // TODO: find how Jan uses this value, if we can use
        // std::env::consts::ARCH directly
        let arch = match std::env::consts::ARCH {
            "x86" => "amd64",
            "x86_64" => "amd64",
            "arm" => "arm64",
            "aarch64" => "arm64",
            _ => "Unsupported",
        };

        CpuStaticInfo {
            name,
            core_count: System::physical_core_count().unwrap_or(0),
            arch: arch.to_string(),
            extensions: CpuStaticInfo::get_extensions(),
        }
    }

    // TODO: see if we need to check for all CPU extensions
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    fn get_extensions() -> Vec<String> {
        let mut exts = vec![];

        // fpu is always present on modern x86 processors,
        // but is_x86_feature_detected doesn't support it
        exts.push("fpu".to_string());
        if is_x86_feature_detected!("mmx") {
            exts.push("mmx".to_string());
        }
        if is_x86_feature_detected!("sse") {
            exts.push("sse".to_string());
        }
        if is_x86_feature_detected!("sse2") {
            exts.push("sse2".to_string());
        }
        if is_x86_feature_detected!("sse3") {
            exts.push("sse3".to_string());
        }
        if is_x86_feature_detected!("ssse3") {
            exts.push("ssse3".to_string());
        }
        if is_x86_feature_detected!("sse4.1") {
            exts.push("sse4_1".to_string());
        }
        if is_x86_feature_detected!("sse4.2") {
            exts.push("sse4_2".to_string());
        }
        if is_x86_feature_detected!("pclmulqdq") {
            exts.push("pclmulqdq".to_string());
        }
        if is_x86_feature_detected!("avx") {
            exts.push("avx".to_string());
        }
        if is_x86_feature_detected!("avx2") {
            exts.push("avx2".to_string());
        }
        if is_x86_feature_detected!("avx512f") {
            exts.push("avx512_f".to_string());
        }
        if is_x86_feature_detected!("avx512dq") {
            exts.push("avx512_dq".to_string());
        }
        if is_x86_feature_detected!("avx512ifma") {
            exts.push("avx512_ifma".to_string());
        }
        if is_x86_feature_detected!("avx512pf") {
            exts.push("avx512_pf".to_string());
        }
        if is_x86_feature_detected!("avx512er") {
            exts.push("avx512_er".to_string());
        }
        if is_x86_feature_detected!("avx512cd") {
            exts.push("avx512_cd".to_string());
        }
        if is_x86_feature_detected!("avx512bw") {
            exts.push("avx512_bw".to_string());
        }
        if is_x86_feature_detected!("avx512vl") {
            exts.push("avx512_vl".to_string());
        }
        if is_x86_feature_detected!("avx512vbmi") {
            exts.push("avx512_vbmi".to_string());
        }
        if is_x86_feature_detected!("avx512vbmi2") {
            exts.push("avx512_vbmi2".to_string());
        }
        if is_x86_feature_detected!("avx512vnni") {
            exts.push("avx512_vnni".to_string());
        }
        if is_x86_feature_detected!("avx512bitalg") {
            exts.push("avx512_bitalg".to_string());
        }
        if is_x86_feature_detected!("avx512vpopcntdq") {
            exts.push("avx512_vpopcntdq".to_string());
        }
        // avx512_4vnniw and avx512_4fmaps are only available on Intel Knights Mill, which are
        // very rare. https://en.wikipedia.org/wiki/AVX-512
        // is_x86_feature_detected doesn't support them
        if is_x86_feature_detected!("avx512vp2intersect") {
            exts.push("avx512_vp2intersect".to_string());
        }
        if is_x86_feature_detected!("aes") {
            exts.push("aes".to_string());
        }
        if is_x86_feature_detected!("f16c") {
            exts.push("f16c".to_string());
        }

        exts
    }

    // Cortex always returns empty list for non-x86
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    fn get_extensions() -> Vec<String> {
        vec![]
    }
}

#[derive(serde::Serialize, Clone, Debug)]
struct GpuStaticInfo {
    name: String,
    index: u64,
    total_memory: u64,
    vendor: String,
    uuid: String,
    driver_version: String,
}

fn get_vulkan_gpus_static_jan<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Vec<vulkan::VulkanStaticInfo> {
    let lib_name = if cfg!(target_os = "windows") {
        "vulkan-1.dll"
    } else if cfg!(target_os = "linux") {
        "libvulkan.so"
    } else {
        return vec![];
    };

    // NOTE: this does not work in test mode (mock app)
    match app.path().resolve(
        format!("lib/{}", lib_name),
        BaseDirectory::Resource,
    ) {
        Ok(lib_path) => {
            let lib_path_str = lib_path.to_string_lossy().to_string();
            vulkan::get_vulkan_gpus_static(&lib_path_str)
        }
        Err(_) => {
            log::error!("Failed to resolve Vulkan library path");
            vec![]
        }
    }
}

fn get_gpu_static_info<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Vec<GpuStaticInfo> {
    let mut seen_uuids = std::collections::HashSet::new();
    let mut gpus = vec![];

    // filter duplicates by UUID. prioritize GPU info from NVML over the one
    // from Vulkan
    for nvidia_gpu in nvidia::get_nvidia_gpus_static() {
        if seen_uuids.insert(nvidia_gpu.uuid.clone()) {
            gpus.push(nvidia_gpu.into());
        }
    }

    let vulkan_gpus = {
        // try to use system Vulkan first
        // if that's not available, try to use the one bundled with Jan
        let vulkan_gpus = vulkan::get_vulkan_gpus_static("");
        if vulkan_gpus.is_empty() {
            get_vulkan_gpus_static_jan(app.clone())
        } else {
            vulkan_gpus
        }
    };
    for vulkan_gpu in vulkan_gpus {
        if seen_uuids.insert(vulkan_gpu.uuid.clone()) {
            gpus.push(vulkan_gpu.into());
        }
    }

    gpus
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemStaticInfo {
    cpu: CpuStaticInfo,
    os: String,
    total_memory: u64,
    gpus: Vec<GpuStaticInfo>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct MemoryUsage {
    used_memory: u64,
    total_memory: u64,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemUsageInfo {
    cpu: f32,
    used_memory: u64,
    total_memory: u64,
    gpus: Vec<MemoryUsage>,
}

impl SystemUsageInfo {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_memory();

        // need to refresh 2 times to get CPU usage
        system.refresh_cpu_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_cpu_all();

        let cpus = system.cpus();
        let cpu_usage =
            cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / (cpus.len().max(1) as f32);
        let used_memory = system.used_memory() / 1024 / 1024; // bytes to MiB
        let total_memory = system.total_memory() / 1024 / 1024; // bytes to MiB

        SystemUsageInfo {
            cpu: cpu_usage,
            used_memory,
            total_memory,
            gpus: nvidia::get_nvidia_gpus_memory_usage(),
        }
    }
}

#[tauri::command]
pub fn get_system_static_info<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> SystemStaticInfo {
    SYSTEM_STATIC_INFO
        .get_or_init(|| {
            let mut system = System::new();
            system.refresh_memory();

            SystemStaticInfo {
                cpu: CpuStaticInfo::new(),
                os: System::long_os_version().unwrap_or("Unknown".to_string()),
                total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB
                gpus: get_gpu_static_info(app.clone()),
            }
        })
        .clone()
}

#[tauri::command]
pub fn get_system_usage_info() -> SystemUsageInfo {
    SystemUsageInfo::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn test_system_static_info() {
        let app = mock_app();
        let sys_info = get_system_static_info(app.handle().clone());
        println!("System Static Info: {:?}", sys_info);
    }

    #[test]
    fn test_system_usage_info() {
        let usage = SystemUsageInfo::new();
        println!("System Usage Info: {:?}", usage);
    }
}
