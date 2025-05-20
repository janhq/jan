use nvml_wrapper::{error::NvmlError, Nvml};
use std::sync::OnceLock;

static NVML: OnceLock<Option<Nvml>> = OnceLock::new();
static NVIDIA_GPUS: OnceLock<Vec<NvidiaStaticInfo>> = OnceLock::new();

// NvmlError doesn't implement Copy, so we have to store an Option in OnceLock
fn get_nvml() -> Option<&'static Nvml> {
    NVML.get_or_init(|| Nvml::init().ok()).as_ref()
}

#[derive(Debug, Clone)]
pub struct NvidiaStaticInfo {
    name: String,
    index: u64,
    total_memory: u64,
    uuid: String,
    driver_version: String,
    // NVIDIA-specific info
    compute_capability: String,
}

impl From<NvidiaStaticInfo> for super::GpuStaticInfo {
    fn from(val: NvidiaStaticInfo) -> Self {
        super::GpuStaticInfo {
            name: val.name,
            index: val.index,
            total_memory: val.total_memory,
            vendor: "NVIDIA".to_string(),
            uuid: val.uuid,
            driver_version: val.driver_version,
        }
    }
}

// old approach, nvidia-smi based
// NOTE: nvidia-smi orders GPUs by PCI bus ID, which can be different from CUDA order.
// pub fn get_nvidia_gpus() -> Vec<NvidiaStaticInfo> {
//     let has_nvidia_smi = match std::process::Command::new("nvidia-smi").output() {
//         Ok(output) => output.status.success(),
//         Err(_) => false,
//     };
//     if !has_nvidia_smi {
//         log::info!("nvidia-smi is not available");
//         return vec![];
//     }

//     // get_gpus1 will return None if there is any error within the logic
//     let get_gpus = || -> Result<Vec<NvidiaStaticInfo>, Box<dyn std::error::Error>> {
//         let mut results = vec![];

//         let output = std::process::Command::new("nvidia-smi")
//             .arg("--query-gpu=index,memory.total,name,compute_cap,driver_version,uuid")
//             .arg("--format=csv,noheader,nounits")
//             .output()?;
//         if !output.status.success() {
//             return Err("nvidia-smi fails".into());
//         }

//         for line in std::str::from_utf8(&output.stdout)?.lines() {
//             let parts: Vec<&str> = line.split(", ").collect();
//             if parts.len() != 6 {
//                 return Err(format!("Unable to parse line: {}", line).into());
//             }
//             let info = NvidiaStaticInfo {
//                 index: parts[0].parse()?,
//                 total_memory: parts[1].parse()?,
//                 name: parts[2].parse()?,
//                 compute_capability: parts[3].parse()?,
//                 driver_version: parts[4].parse()?,
//                 uuid: parts[5].parse()?,
//             };
//             results.push(info);
//         }

//         Ok(results)
//     };
//     match get_gpus() {
//         Ok(gpus) => return gpus,
//         Err(e) => {
//             log::error!("Failed to get NVIDIA GPUs: {}. Attempting fallback", e);
//         }
//     }

//     // old driver versions might not have compute_cap field
//     let get_gpus_fallback = || -> Result<Vec<NvidiaStaticInfo>, Box<dyn std::error::Error>> {
//         let mut results = vec![];

//         let output = std::process::Command::new("nvidia-smi")
//             .arg("--query-gpu=index,memory.total,name,driver_version,uuid")
//             .arg("--format=csv,noheader,nounits")
//             .output()?;
//         if !output.status.success() {
//             return Err("nvidia-smi fails".into());
//         }

//         for line in std::str::from_utf8(&output.stdout)?.lines() {
//             let parts: Vec<&str> = line.split(", ").collect();
//             if parts.len() != 5 {
//                 return Err(format!("Unable to parse line: {}", line).into());
//             }
//             let info = NvidiaStaticInfo {
//                 index: parts[0].parse()?,
//                 total_memory: parts[1].parse()?,
//                 name: parts[2].parse()?,
//                 compute_capability: "unknown".to_string(),
//                 driver_version: parts[3].parse()?,
//                 uuid: parts[4].parse()?,
//             };
//             results.push(info);
//         }

//         Ok(results)
//     };
//     match get_gpus_fallback() {
//         Ok(gpus) => return gpus,
//         Err(e) => {
//             log::error!("Failed to get NVIDIA GPUs: {}", e);
//         }
//     }

//     vec![]
// }

pub fn get_nvidia_gpus_static() -> Vec<NvidiaStaticInfo> {
    NVIDIA_GPUS
        .get_or_init(|| match get_nvidia_gpus_static_internal() {
            Ok(gpus) => gpus,
            Err(e) => {
                log::error!("Failed to get NVIDIA GPUs: {}", e);
                vec![]
            }
        })
        .clone()
}

fn get_nvidia_gpus_static_internal() -> Result<Vec<NvidiaStaticInfo>, NvmlError> {
    let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
    let num_gpus = nvml.device_count()?;
    let driver_version = nvml.sys_driver_version()?;

    let mut gpus = Vec::with_capacity(num_gpus as usize);
    for i in 0..num_gpus {
        let device = nvml.device_by_index(i)?;
        gpus.push(NvidiaStaticInfo {
            name: device.name()?,
            index: i as u64,
            total_memory: device.memory_info()?.total / 1024 / 1024, // bytes to MiB
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
}

pub fn get_nvidia_gpus_memory_usage() -> Vec<super::MemoryUsage> {
    match get_nvidia_gpus_memory_usage_internal() {
        Ok(gpus) => gpus,
        Err(e) => {
            log::error!("Failed to get NVIDIA GPUs memory usage: {}", e);
            vec![]
        }
    }
}

fn get_nvidia_gpus_memory_usage_internal() -> Result<Vec<super::MemoryUsage>, NvmlError> {
    let nvml = get_nvml().ok_or(NvmlError::Unknown)?;
    let num_gpus = nvml.device_count()?;

    // NOTE: assume ordering is fixed within the same NVML instance
    let mut mem_usage_list = Vec::with_capacity(num_gpus as usize);
    for i in 0..num_gpus {
        let device = nvml.device_by_index(i)?;
        let mem_info = device.memory_info()?;
        mem_usage_list.push(super::MemoryUsage {
            used_memory: mem_info.used / 1024 / 1024,   // bytes to MiB
            total_memory: mem_info.total / 1024 / 1024, // bytes to MiB
        });
    }

    Ok(mem_usage_list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_nvidia_gpus_static() {
        let gpus = get_nvidia_gpus_static();
        for (i, gpu) in gpus.iter().enumerate() {
            println!("GPU {}: {:?}", i, gpu);
        }
    }

    #[test]
    fn test_get_nvidia_gpus_memory_usage() {
        let usage_list = get_nvidia_gpus_memory_usage();
        for (i, usage) in usage_list.iter().enumerate() {
            println!("GPU {}: {:?}", i, usage);
        }
    }
}
