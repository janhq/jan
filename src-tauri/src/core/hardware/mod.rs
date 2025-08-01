pub mod amd;
pub mod nvidia;
pub mod vulkan;

use std::sync::OnceLock;
use sysinfo::System;
use tauri::{path::BaseDirectory, Manager};

static SYSTEM_INFO: OnceLock<SystemInfo> = OnceLock::new();

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
            .map(|cpu| {
                let brand = cpu.brand();
                if brand.is_empty() {
                    cpu.name()
                } else {
                    brand
                }
            })
            .unwrap_or("unknown")
            .to_string();

        CpuStaticInfo {
            name,
            core_count: System::physical_core_count().unwrap_or(0),
            arch: std::env::consts::ARCH.to_string(),
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

// https://devicehunt.com/all-pci-vendors
pub const VENDOR_ID_AMD: u32 = 0x1002;
pub const VENDOR_ID_NVIDIA: u32 = 0x10DE;
pub const VENDOR_ID_INTEL: u32 = 0x8086;

#[derive(Debug, Clone)]
pub enum Vendor {
    AMD,
    NVIDIA,
    Intel,
    Unknown(u32),
}

impl serde::Serialize for Vendor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Vendor::AMD => "AMD".serialize(serializer),
            Vendor::NVIDIA => "NVIDIA".serialize(serializer),
            Vendor::Intel => "Intel".serialize(serializer),
            Vendor::Unknown(vendor_id) => {
                let formatted = format!("Unknown (vendor_id: {})", vendor_id);
                serializer.serialize_str(&formatted)
            }
        }
    }
}

impl Vendor {
    pub fn from_vendor_id(vendor_id: u32) -> Self {
        match vendor_id {
            VENDOR_ID_AMD => Vendor::AMD,
            VENDOR_ID_NVIDIA => Vendor::NVIDIA,
            VENDOR_ID_INTEL => Vendor::Intel,
            _ => Vendor::Unknown(vendor_id),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub total_memory: u64,
    pub vendor: Vendor,
    pub uuid: String,
    pub driver_version: String,
    pub nvidia_info: Option<nvidia::NvidiaInfo>,
    pub vulkan_info: Option<vulkan::VulkanInfo>,
}

impl GpuInfo {
    pub fn get_usage(&self) -> GpuUsage {
        match self.vendor {
            Vendor::NVIDIA => self.get_usage_nvidia(),
            Vendor::AMD => self.get_usage_amd(),
            _ => self.get_usage_unsupported(),
        }
    }

    pub fn get_usage_unsupported(&self) -> GpuUsage {
        GpuUsage {
            uuid: self.uuid.clone(),
            used_memory: 0,
            total_memory: 0,
        }
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemInfo {
    cpu: CpuStaticInfo,
    os_type: String,
    os_name: String,
    total_memory: u64,
    gpus: Vec<GpuInfo>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct GpuUsage {
    uuid: String,
    used_memory: u64,
    total_memory: u64,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemUsage {
    cpu: f32,
    used_memory: u64,
    total_memory: u64,
    gpus: Vec<GpuUsage>,
}

fn get_jan_libvulkan_path<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> String {
    let lib_name = if cfg!(target_os = "windows") {
        "vulkan-1.dll"
    } else if cfg!(target_os = "linux") {
        "libvulkan.so"
    } else {
        return "".to_string();
    };

    // NOTE: this does not work in test mode (mock app)
    match app.path().resolve(
        format!("resources/lib/{}", lib_name),
        BaseDirectory::Resource,
    ) {
        Ok(lib_path) => lib_path.to_string_lossy().to_string(),
        Err(_) => "".to_string(),
    }
}

#[tauri::command]
pub fn get_system_info<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> SystemInfo {
    SYSTEM_INFO
        .get_or_init(|| {
            let mut system = System::new();
            system.refresh_memory();

            let mut gpu_map = std::collections::HashMap::new();
            for gpu in nvidia::get_nvidia_gpus() {
                gpu_map.insert(gpu.uuid.clone(), gpu);
            }

            // try system vulkan first
            let paths = vec!["".to_string(), get_jan_libvulkan_path(app.clone())];
            let mut vulkan_gpus = vec![];
            for path in paths {
                vulkan_gpus = vulkan::get_vulkan_gpus(&path);
                if !vulkan_gpus.is_empty() {
                    break;
                }
            }

            for gpu in vulkan_gpus {
                match gpu_map.get_mut(&gpu.uuid) {
                    // for existing NVIDIA GPUs, add Vulkan info
                    Some(nvidia_gpu) => {
                        nvidia_gpu.vulkan_info = gpu.vulkan_info;
                    }
                    None => {
                        gpu_map.insert(gpu.uuid.clone(), gpu);
                    }
                }
            }

            let os_type = if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "macos") {
                "macos"
            } else if cfg!(target_os = "linux") {
                "linux"
            } else {
                "unknown"
            };
            let os_name = System::long_os_version().unwrap_or("Unknown".to_string());

            SystemInfo {
                cpu: CpuStaticInfo::new(),
                os_type: os_type.to_string(),
                os_name,
                total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB
                gpus: gpu_map.into_values().collect(),
            }
        })
        .clone()
}

#[tauri::command]
pub fn get_system_usage<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> SystemUsage {
    let mut system = System::new();
    system.refresh_memory();

    // need to refresh 2 times to get CPU usage
    system.refresh_cpu_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_all();

    let cpus = system.cpus();
    let cpu_usage =
        cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / (cpus.len().max(1) as f32);

    SystemUsage {
        cpu: cpu_usage,
        used_memory: system.used_memory() / 1024 / 1024, // bytes to MiB,
        total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB,
        gpus: get_system_info(app.clone())
            .gpus
            .iter()
            .map(|gpu| gpu.get_usage())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn test_system_info() {
        let app = mock_app();
        let info = get_system_info(app.handle().clone());
        println!("System Static Info: {:?}", info);
    }

    #[test]
    fn test_system_usage() {
        let app = mock_app();
        let usage = get_system_usage(app.handle().clone());
        println!("System Usage Info: {:?}", usage);
    }
}
