use crate::types::{GpuInfo, GpuUsage};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use {
    crate::types::Vendor,
    nvml_wrapper::{error::NvmlError, Nvml},
    std::sync::RwLock,
};

/// Tri-state for the NVML handle. We must distinguish "never tried" from
/// "tried and failed": without this, every System Monitor poll (~every 5s)
/// re-attempts `Nvml::init()` on hosts that have no `nvml.dll` /
/// `libnvidia-ml.so` (e.g. all macOS machines, or Windows/Linux without an
/// NVIDIA card) and re-logs the failure forever. `Failed` short-circuits the
/// retry so the warning is emitted exactly once per process (or once per
/// resume on Linux, where `invalidate_nvml` resets to `Uninit`).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
enum NvmlState {
    Uninit,
    Failed,
    Ready(Nvml),
}

/// NVML handle. On Linux we use RwLock so we can invalidate after sleep/resume
/// and re-initialize when the driver is ready again.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static NVML: RwLock<NvmlState> = RwLock::new(NvmlState::Uninit);

#[derive(Debug, Clone, serde::Serialize)]
pub struct NvidiaInfo {
    pub index: u32,
    pub compute_capability: String,
}

/// Run a closure with the current NVML handle, initializing if needed.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn with_nvml<F, R>(f: F) -> R
where
    F: FnOnce(Option<&Nvml>) -> R,
{
    // Try read first for the common case (already resolved, either way)
    {
        let guard = NVML.read().expect("RwLock poisoned");
        match &*guard {
            NvmlState::Ready(nvml) => return f(Some(nvml)),
            // Already attempted and failed — return without re-trying or
            // re-logging. This is what stops the per-poll log spam.
            NvmlState::Failed => return f(None),
            NvmlState::Uninit => {}
        }
    }
    // Not initialized or was invalidated: try to init exactly once.
    {
        let mut guard = NVML.write().expect("RwLock poisoned");
        if matches!(&*guard, NvmlState::Uninit) {
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
                    *guard = NvmlState::Ready(nvml);
                }
                Err(e) => {
                    // Logged at `warn!` so the failure is visible in
                    // release-build logs (which default to INFO+), but only
                    // ONCE: the `Failed` state below short-circuits every
                    // subsequent poll. Without this, "no NVIDIA GPUs
                    // detected" is indistinguishable from "NVML didn't load"
                    // in user bug reports.
                    log::warn!("Unable to initialize NVML: {}", e);
                    *guard = NvmlState::Failed;
                }
            }
        }
        match &*guard {
            NvmlState::Ready(nvml) => f(Some(nvml)),
            _ => f(None),
        }
    }
}

/// Invalidates the NVML handle so the next use re-initializes. Call after system
/// resume on Linux when the GPU driver state has been reset.
#[cfg(target_os = "linux")]
pub fn invalidate_nvml() {
    let mut guard = NVML.write().expect("RwLock poisoned");
    *guard = NvmlState::Uninit;
    log::debug!("NVML invalidated (e.g. after resume); will re-init on next use");
}

/// No-op on non-Linux; invalidation is only needed for Linux sleep/resume.
#[cfg(not(target_os = "linux"))]
pub fn invalidate_nvml() {}

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
                    // Defense-in-depth: the `GpuInfo::get_usage` dispatcher
                    // in `gpu.rs` now guards this with
                    // `Vendor::NVIDIA if self.nvidia_info.is_some()`, so
                    // this branch is unreachable in normal flow. Kept as
                    // `trace!` (was `error!`, which spammed every poll on
                    // hosts where NVML and Vulkan returned mismatched
                    // UUIDs for the same NVIDIA card — see the 2026-05-27
                    // ADR) in case future call sites bypass the
                    // dispatcher.
                    log::trace!(
                        "get_usage_nvidia called on an entry with no NVML index \
                         (e.g. a Vulkan-only enumeration of an NVIDIA GPU); \
                         returning empty usage"
                    );
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
        with_nvml(|nvml| {
            let nvml = nvml.ok_or(NvmlError::Unknown)?;
            let device = nvml.device_by_index(index)?;
            let mem_info = device.memory_info()?;

            Ok(GpuUsage {
                uuid: self.uuid.clone(),
                used_memory: mem_info.used / (1024 * 1024), // bytes to MiB
                total_memory: mem_info.total / (1024 * 1024), // bytes to MiB
            })
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
    with_nvml(|nvml| {
        let nvml = match nvml {
            Some(n) => n,
            None => {
                // `trace!`, not `warn!`: this branch is hit on EVERY poll
                // when NVML is unavailable, so warning here spams the log.
                // The actual reason was already logged once at `warn!` by
                // the init-failure path in `with_nvml`.
                log::trace!("NVML not available — NVIDIA GPUs will not be enumerated");
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
    })
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
