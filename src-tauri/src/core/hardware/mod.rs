pub mod nvidia;

use sysinfo::{MemoryRefreshKind, System};

// NOTE: some these can be enum
// TODO: for numbers, check int or float
// TODO: some values can be init once e.g. CPU info (except CPU usage)
#[derive(serde::Serialize)]
pub struct Cpu {
    arch: String,
    cores: usize,
    instructions: Vec<String>,
    model: String,
    usage: f32,
}

impl Cpu {
    pub fn new() -> Cpu {
        let mut system = System::new();

        // need to refresh 2 times to get CPU usage
        system.refresh_cpu_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_cpu_all();

        let model;
        let usage;
        let cpus = system.cpus();
        if !cpus.is_empty() {
            let mut total_usage = 0.0;
            for cpu in cpus {
                total_usage += cpu.cpu_usage();
            }
            model = cpus[0].brand();
            usage = total_usage / (cpus.len() as f32);
        } else {
            model = "unknown";
            usage = 0.0;
        }

        Cpu {
            // NOTE: cortex returns either amd64 or arm64
            arch: std::env::consts::ARCH.to_string(),
            cores: System::physical_core_count().unwrap_or(0),
            instructions: Cpu::get_supported_cpu_extensions(),
            model: model.to_string(),
            usage,
        }
    }

    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    fn get_supported_cpu_extensions() -> Vec<String> {
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
    fn get_supported_cpu_extensions() -> Vec<String> {
        vec![]
    }
}

#[derive(serde::Serialize)]
pub struct GpuAdditionalInfo {
    compute_cap: String,
    driver_version: String,
}

#[derive(serde::Serialize)]
pub struct Gpu {
    activated: bool,
    additional_information: Option<GpuAdditionalInfo>,
    free_vram: u64,
    id: String,
    name: String,
    total_vram: u64,
    uuid: String,
    version: String,
}

impl Gpu {
    pub fn get_gpus() -> Vec<Gpu> {
        nvidia::get_nvidia_gpus()
            .into_iter()
            .map(|gpu| gpu.into())
            .collect()
    }
}

#[derive(serde::Serialize)]
pub struct Os {
    name: String,
    version: String,
}

impl Os {
    pub fn new() -> Os {
        // Cortex uses https://github.com/lfreist/hwinfo
        let name;
        if cfg!(target_os = "macos") {
            name = "macOS".to_string();
        } else {
            name = System::long_os_version().unwrap_or("unknown".to_string());
        }
        Os {
            name,
            version: System::os_version().unwrap_or("unknown".to_string()),
        }
    }
}

#[derive(serde::Serialize)]
pub struct Ram {
    available: u64,
    total: u64,
}

impl Ram {
    pub fn new() -> Ram {
        let mut system = System::new();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());

        // system.free_memory() and .available_memory() is a bit strange on macOS
        // TODO: check on Windows and Ubuntu
        let total_mem = system.total_memory();
        let avail_mem = total_mem - system.used_memory();
        Ram {
            available: avail_mem / 1024 / 1024, // bytes to MiB
            total: total_mem / 1024 / 1024,     // bytes to MiB
        }
    }
}

#[derive(serde::Serialize)]
pub struct HardwareInfo {
    cpu: Cpu,
    gpus: Vec<Gpu>,
    os: Os,
    ram: Ram,
}

#[tauri::command]
pub fn get_hardware_info() -> HardwareInfo {
    HardwareInfo {
        cpu: Cpu::new(),
        gpus: Gpu::get_gpus(),
        os: Os::new(),
        ram: Ram::new(),
    }
}
