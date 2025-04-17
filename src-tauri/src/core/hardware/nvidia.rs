#[derive(serde::Deserialize)]
pub struct NvidiaInfo {
    index: u64,
    total_vram: u64,
    free_vram: u64,
    name: String,
    compute_cap: String,
    driver_version: String,
    uuid: String,
}

impl From<NvidiaInfo> for super::Gpu {
    fn from(val: NvidiaInfo) -> Self {
        super::Gpu {
            activated: true,
            additional_information: Some(super::GpuAdditionalInfo {
                compute_cap: val.compute_cap,
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

#[derive(serde::Deserialize)]
struct NvidiaInfoFallback {
    index: u64,
    total_vram: u64,
    free_vram: u64,
    name: String,
    driver_version: String,
    uuid: String,
}

impl From<NvidiaInfoFallback> for NvidiaInfo {
    fn from(val: NvidiaInfoFallback) -> Self {
        NvidiaInfo {
            index: val.index,
            total_vram: val.total_vram,
            free_vram: val.free_vram,
            name: val.name,
            compute_cap: "unknown".to_string(),
            driver_version: val.driver_version,
            uuid: val.uuid,
        }
    }
}

pub fn get_nvidia_gpus() -> Vec<NvidiaInfo> {
    let has_nvidia_smi = match std::process::Command::new("nvidia-smi").output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    };
    if !has_nvidia_smi {
        return vec![];
    }

    // get_gpus1 will return None if there is any error within the logic
    let get_gpus = || -> Option<Vec<NvidiaInfo>> {
        let mut results = vec![];

        let output = std::process::Command::new("nvidia-smi")
            .arg("--query-gpu=index,memory.total,memory.free,name,compute_cap,driver_version,uuid")
            .arg("--format=csv,noheader,nounits")
            .output()
            .ok()?;

        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader((&output.stdout) as &[u8]);
        for result in rdr.deserialize() {
            results.push(result.ok()?);
        }

        Some(results)
    };
    if let Some(gpus) = get_gpus() {
        return gpus;
    }

    let get_gpus_fallback = || -> Option<Vec<NvidiaInfo>> {
        let mut results = vec![];

        let output = std::process::Command::new("nvidia-smi")
            .arg("--query-gpu=index,memory.total,memory.free,name,driver_version,uuid")
            .arg("--format=csv,noheader,nounits")
            .output()
            .ok()?;

        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader((&output.stdout) as &[u8]);
        for result in rdr.deserialize() {
            let info_fallback: NvidiaInfoFallback = result.ok()?;
            let info: NvidiaInfo = info_fallback.into();
            results.push(info);
        }

        Some(results)
    };
    if let Some(gpus) = get_gpus_fallback() {
        return gpus;
    }

    vec![]
}
