use crate::types::{GpuInfo, GpuUsage, Vendor};
use nvml_wrapper::{error::NvmlError, Nvml};
use std::sync::OnceLock;

static NVML: OnceLock<Option<Nvml>> = OnceLock::new();

#[derive(Debug, Clone, serde::Serialize)]
pub struct NvidiaInfo {
    pub index: u32,
    pub compute_capability: String,
}

fn get_nvml() -> Option<&'static Nvml> {
    NVML.get_or_init(|| {
        let result = Nvml::init().or_else(|e| {
            // fallback
            if cfg!(target_os = "linux") {
                let lib_path = std::ffi::OsStr::new("libnvidia-ml.so.1");
                Nvml::builder().lib_path(lib_path).init()
            } else {
                Err(e)
            }
        });

        // NvmlError doesn't implement Copy, so we have to store an Option in OnceLock
        match result {
            Ok(nvml) => Some(nvml),
            Err(e) => {
                log::error!("Unable to initialize NVML: {}", e);
                None
            }
        }
    })
    .as_ref()
}

impl GpuInfo {
    pub fn get_usage_nvidia(&self) -> GpuUsage {
        let index = match self.nvidia_info {
            Some(ref nvidia_info) => nvidia_info.index,
            None => {
                log::error!("get_usage_nvidia() called on non-NVIDIA GPU");
                return self.get_usage_unsupported();
            }
        };
        let closure = || -> Result<GpuUsage, NvmlError> {
            let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
            let device = nvml.device_by_index(index)?;
            let mem_info = device.memory_info()?;
            Ok(GpuUsage {
                uuid: self.uuid.clone(),
                used_memory: mem_info.used / 1024 / 1024, // bytes to MiB
                total_memory: mem_info.total / 1024 / 1024, // bytes to MiB
            })
        };
        closure().unwrap_or_else(|e| {
            log::error!("Failed to get memory usage for NVIDIA GPU {}: {}", index, e);
            self.get_usage_unsupported()
        })
    }
}

pub fn get_nvidia_gpus() -> Vec<GpuInfo> {
    let closure = || -> Result<Vec<GpuInfo>, NvmlError> {
        let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
        let num_gpus = nvml.device_count()?;
        let driver_version = nvml.sys_driver_version()?;

        let mut gpus = Vec::with_capacity(num_gpus as usize);
        for i in 0..num_gpus {
            let device = nvml.device_by_index(i)?;
            gpus.push(GpuInfo {
                name: device.name()?,
                total_memory: device.memory_info()?.total / 1024 / 1024, // bytes to MiB
                vendor: Vendor::NVIDIA,
                uuid: {
                    let mut uuid = device.uuid()?;
                    if uuid.starts_with("GPU-") {
                        uuid = uuid[4..].to_string();
                    }
                    uuid
                },
                driver_version: driver_version.clone(),
                nvidia_info: Some(NvidiaInfo {
                    index: i,
                    compute_capability: {
                        let cc = device.cuda_compute_capability()?;
                        format!("{}.{}", cc.major, cc.minor)
                    },
                }),
                vulkan_info: None,
            });
        }

        Ok(gpus)
    };

    match closure() {
        Ok(gpus) => gpus,
        Err(e) => {
            log::error!("Failed to get NVIDIA GPUs: {}", e);
            vec![]
        }
    }
}
