use nvml_wrapper::{error::NvmlError, Nvml};
use std::sync::OnceLock;

static NVML: OnceLock<Option<Nvml>> = OnceLock::new();

// NvmlError doesn't implement Copy, so we have to store an Option in OnceLock
fn get_nvml() -> Option<&'static Nvml> {
    NVML.get_or_init(|| Nvml::init().ok()).as_ref()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NvidiaGpu {
    pub name: String,
    pub index: u64,
    pub total_memory: u64,
    pub vendor: super::Vendor,
    pub uuid: String,
    pub driver_version: String,
    // NVIDIA-specific info
    pub compute_capability: String,
}

impl NvidiaGpu {
    pub fn get_usage(&self) -> super::GpuUsage {
        let closure = || -> Result<super::GpuUsage, NvmlError> {
            let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
            let device = nvml.device_by_index(self.index as u32)?;
            let mem_info = device.memory_info()?;
            Ok(super::GpuUsage {
                uuid: self.uuid.clone(),
                used_memory: mem_info.used / 1024 / 1024, // bytes to MiB
                total_memory: mem_info.total / 1024 / 1024, // bytes to MiB
            })
        };
        closure().unwrap_or_else(|e| {
            log::error!("Failed to get memory usage for GPU {}: {}", self.index, e);
            super::GpuUsage {
                uuid: self.uuid.clone(),
                used_memory: 0,
                total_memory: 0,
            }
        })
    }
}

pub fn get_nvidia_gpus() -> Vec<NvidiaGpu> {
    let closure = || -> Result<Vec<NvidiaGpu>, NvmlError> {
        let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
        let num_gpus = nvml.device_count()?;
        let driver_version = nvml.sys_driver_version()?;

        let mut gpus = Vec::with_capacity(num_gpus as usize);
        for i in 0..num_gpus {
            let device = nvml.device_by_index(i)?;
            gpus.push(NvidiaGpu {
                name: device.name()?,
                index: i as u64,
                total_memory: device.memory_info()?.total / 1024 / 1024, // bytes to MiB
                vendor: super::Vendor::NVIDIA,
                uuid: {
                    let mut uuid = device.uuid()?;
                    if uuid.starts_with("GPU-") {
                        uuid = uuid[4..].to_string();
                    }
                    uuid
                },
                driver_version: driver_version.clone(),
                compute_capability: {
                    let cc = device.cuda_compute_capability()?;
                    format!("{}.{}", cc.major, cc.minor)
                },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_nvidia_gpus() {
        let gpus = get_nvidia_gpus();
        for (i, gpu) in gpus.iter().enumerate() {
            println!("GPU {}:", i);
            println!("    {:?}", gpu);
            println!("    {:?}", gpu.get_usage());
        }
    }
}
