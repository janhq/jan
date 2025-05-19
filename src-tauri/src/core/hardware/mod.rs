pub mod nvidia;

use std::sync::OnceLock;
use sysinfo::{MemoryRefreshKind, System};

static CPU_STATIC_INFO: OnceLock<CpuStaticInfo> = OnceLock::new();
static OS_NAME: OnceLock<String> = OnceLock::new();

#[derive(Clone)]
struct CpuStaticInfo {
    name: String,
    core_count: usize,
    arch: String,
    extensions: Vec<String>,
}

impl CpuStaticInfo {
    fn new() -> Self {
        CPU_STATIC_INFO
            .get_or_init(|| {
                let name = System::new()
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
            })
            .clone()
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

fn get_os_name() -> &'static String {
    OS_NAME.get_or_init(|| System::long_os_version().unwrap_or("unknown".to_string()))
}

// NOTE: some these can be enum
// TODO: separate static info and dynamic info (e.g. CPU cores vs CPU usage)
#[derive(serde::Serialize)]
pub struct CpuInfo {
    name: String,
    core_count: usize,
    arch: String,
    extensions: Vec<String>,
    usage: f32,
}

impl CpuInfo {
    pub fn new() -> CpuInfo {
        let mut system = System::new();

        // need to refresh 2 times to get CPU usage
        system.refresh_cpu_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_cpu_all();

        let cpus = system.cpus();
        let total_usage = cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>();
        let usage = total_usage / (cpus.len().max(1) as f32);

        let static_info = CpuStaticInfo::new();

        CpuInfo {
            name: static_info.name.to_string(),
            core_count: static_info.core_count,
            arch: static_info.arch.clone(),
            extensions: static_info.extensions.clone(),
            usage,
        }
    }
}

#[derive(serde::Serialize)]
pub struct GpuAdditionalInfo {
    compute_cap: String,
}

#[derive(serde::Serialize)]
pub enum GpuVendor {
    Nvidia,
    AMD,
    Intel,
    Unknown,
}

// TODO: we might not need everything in this struct
#[derive(serde::Serialize)]
pub struct GpuInfo {
    name: String,
    index: u64,
    memory: MemoryInfo,
    vendor: GpuVendor,
    uuid: String,
    driver_version: String,
    additional_information: Option<GpuAdditionalInfo>,
}

impl GpuInfo {
    pub fn get_gpus() -> Vec<GpuInfo> {
        nvidia::get_nvidia_gpus()
            .into_iter()
            .map(|gpu| gpu.into())
            .collect()
    }
}

#[derive(serde::Serialize)]
pub struct MemoryInfo {
    total: u64, // in MiB
    used: u64,
}

impl MemoryInfo {
    pub fn new() -> MemoryInfo {
        let mut system = System::new();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());

        MemoryInfo {
            total: system.total_memory() / 1024 / 1024, // bytes to MiB
            used: system.used_memory() / 1024 / 1024,
        }
    }
}

#[derive(serde::Serialize)]
pub struct SystemInfo {
    cpu: CpuInfo,
    os: String,
    memory: MemoryInfo,
    gpus: Vec<GpuInfo>,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        cpu: CpuInfo::new(),
        os: get_os_name().to_string(),
        memory: MemoryInfo::new(),
        gpus: GpuInfo::get_gpus(),
    }
}
