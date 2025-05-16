pub struct NvidiaInfo {
    name: String,
    index: u64,
    total_vram: u64,
    free_vram: u64,
    compute_capability: String,
    driver_version: String,
    uuid: String,
}

impl From<NvidiaInfo> for super::GpuInfo {
    fn from(val: NvidiaInfo) -> Self {
        super::GpuInfo {
            additional_information: Some(super::GpuAdditionalInfo {
                compute_cap: val.compute_capability,
                driver_version: val.driver_version.clone(),
            }),
            free_vram: val.free_vram,
            id: val.index.to_string(),
            name: val.name,
            total_vram: val.total_vram,
            uuid: val.uuid,
            version: val.driver_version,
        }
    }
}

pub fn get_nvidia_gpus() -> Vec<NvidiaInfo> {
    let has_nvidia_smi = match std::process::Command::new("nvidia-smi").output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    };
    if !has_nvidia_smi {
        log::info!("nvidia-smi is not available");
        return vec![];
    }

    // get_gpus1 will return None if there is any error within the logic
    let get_gpus = || -> Result<Vec<NvidiaInfo>, Box<dyn std::error::Error>> {
        let mut results = vec![];

        let output = std::process::Command::new("nvidia-smi")
            .arg("--query-gpu=index,memory.total,memory.free,name,compute_cap,driver_version,uuid")
            .arg("--format=csv,noheader,nounits")
            .output()?;
        if !output.status.success() {
            return Err("nvidia-smi fails".into());
        }

        for line in std::str::from_utf8(&output.stdout)?.lines() {
            let parts: Vec<&str> = line.split(", ").collect();
            if parts.len() != 7 {
                return Err(format!("Unable to parse line: {}", line).into());
            }
            let info = NvidiaInfo {
                index: parts[0].parse()?,
                total_vram: parts[1].parse()?,
                free_vram: parts[2].parse()?,
                name: parts[3].parse()?,
                compute_capability: parts[4].parse()?,
                driver_version: parts[5].parse()?,
                uuid: parts[6].parse()?,
            };
            results.push(info);
        }

        Ok(results)
    };
    match get_gpus() {
        Ok(gpus) => return gpus,
        Err(e) => {
            log::error!("Failed to get NVIDIA GPUs: {}. Attempting fallback", e);
        }
    }

    // old driver versions might not have compute_cap field
    let get_gpus_fallback = || -> Result<Vec<NvidiaInfo>, Box<dyn std::error::Error>> {
        let mut results = vec![];

        let output = std::process::Command::new("nvidia-smi")
            .arg("--query-gpu=index,memory.total,memory.free,name,driver_version,uuid")
            .arg("--format=csv,noheader,nounits")
            .output()?;
        if !output.status.success() {
            return Err("nvidia-smi fails".into());
        }

        for line in std::str::from_utf8(&output.stdout)?.lines() {
            let parts: Vec<&str> = line.split(", ").collect();
            if parts.len() != 6 {
                return Err(format!("Unable to parse line: {}", line).into());
            }
            let info = NvidiaInfo {
                index: parts[0].parse()?,
                total_vram: parts[1].parse()?,
                free_vram: parts[2].parse()?,
                name: parts[3].parse()?,
                compute_capability: "unknown".to_string(),
                driver_version: parts[4].parse()?,
                uuid: parts[5].parse()?,
            };
            results.push(info);
        }

        Ok(results)
    };
    match get_gpus_fallback() {
        Ok(gpus) => return gpus,
        Err(e) => {
            log::error!("Failed to get NVIDIA GPUs: {}", e);
        }
    }

    vec![]
}
