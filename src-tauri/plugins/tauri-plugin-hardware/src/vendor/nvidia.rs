use crate::types::{GpuInfo, GpuUsage};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use {
    crate::types::Vendor,
    nvml_wrapper::{error::NvmlError, Nvml},
    std::sync::OnceLock,
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
static NVML: OnceLock<Option<Nvml>> = OnceLock::new();

#[derive(Debug, Clone, serde::Serialize)]
pub struct NvidiaInfo {
    pub index: u32,
    pub compute_capability: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_nvml() -> Option<&'static Nvml> {
    NVML.get_or_init(|| {
        // Try to initialize NVML, with fallback for Linux
        let result = Nvml::init().or_else(|e| {
            if cfg!(target_os = "linux") {
                log::debug!("NVML init failed, trying Linux fallback: {}", e);
                let lib_path = std::ffi::OsStr::new("libnvidia-ml.so.1");
                Nvml::builder().lib_path(lib_path).init()
            } else {
                Err(e)
            }
        });

        match result {
            Ok(nvml) => {
                log::debug!("NVML initialized successfully");
                Some(nvml)
            }
            Err(e) => {
                log::debug!("Unable to initialize NVML: {}", e);
                None
            }
        }
    })
    .as_ref()
}

impl GpuInfo {
    pub fn get_usage_nvidia(&self) -> GpuUsage {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            log::warn!("NVIDIA GPU usage detection is not supported on mobile platforms");
            return self.get_usage_unsupported();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let index = match &self.nvidia_info {
                Some(nvidia_info) => nvidia_info.index,
                None => {
                    log::error!("get_usage_nvidia() called on non-NVIDIA GPU");
                    return self.get_usage_unsupported();
                }
            };

            self.get_nvidia_memory_usage(index)
                .unwrap_or_else(|e| {
                    log::error!("Failed to get memory usage for NVIDIA GPU {}: {}", index, e);
                    self.get_usage_unsupported()
                })
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn get_nvidia_memory_usage(&self, index: u32) -> Result<GpuUsage, NvmlError> {
        let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
        let device = nvml.device_by_index(index)?;
        let mem_info = device.memory_info()?;

        Ok(GpuUsage {
            uuid: self.uuid.clone(),
            used_memory: mem_info.used / (1024 * 1024), // bytes to MiB
            total_memory: mem_info.total / (1024 * 1024), // bytes to MiB
        })
    }
}

pub fn get_nvidia_gpus() -> Vec<GpuInfo> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // On mobile platforms, NVIDIA GPU detection is not supported
        log::info!("NVIDIA GPU detection is not supported on mobile platforms");
        vec![]
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        get_nvidia_gpus_internal()
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_nvidia_gpus_internal() -> Vec<GpuInfo> {
    let nvml = match get_nvml() {
        Some(nvml) => nvml,
        None => {
            log::debug!("NVML not available");
            return vec![];
        }
    };

    let (num_gpus, driver_version) = match (nvml.device_count(), nvml.sys_driver_version()) {
        (Ok(count), Ok(version)) => (count, version),
        (Err(e), _) | (_, Err(e)) => {
            log::error!("Failed to get NVIDIA system info: {}", e);
            return vec![];
        }
    };

    let mut gpus = Vec::with_capacity(num_gpus as usize);

    for i in 0..num_gpus {
        match create_gpu_info(nvml, i, &driver_version) {
            Ok(gpu_info) => gpus.push(gpu_info),
            Err(e) => log::warn!("Failed to get info for NVIDIA GPU {}: {}", i, e),
        }
    }

    gpus
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_gpu_info(nvml: &Nvml, index: u32, driver_version: &str) -> Result<GpuInfo, NvmlError> {
    let device = nvml.device_by_index(index)?;
    let memory_info = device.memory_info()?;
    let compute_capability = device.cuda_compute_capability()?;

    let uuid = device.uuid()?;
    let clean_uuid = if uuid.starts_with("GPU-") {
        uuid[4..].to_string()
    } else {
        uuid
    };

    Ok(GpuInfo {
        name: device.name()?,
        total_memory: memory_info.total / (1024 * 1024), // bytes to MiB
        vendor: Vendor::NVIDIA,
        uuid: clean_uuid,
        driver_version: driver_version.to_string(),
        nvidia_info: Some(NvidiaInfo {
            index,
            compute_capability: format!("{}.{}", compute_capability.major, compute_capability.minor),
        }),
        vulkan_info: None,
    })
}
