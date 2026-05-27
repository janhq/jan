use crate::{
    constants::{VENDOR_ID_AMD, VENDOR_ID_INTEL, VENDOR_ID_NVIDIA},
    types::{GpuInfo, GpuUsage, Vendor},
};

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

impl GpuInfo {
    pub fn get_usage(&self) -> GpuUsage {
        match self.vendor {
            // Only dispatch to the NVML path when this entry actually carries
            // an NVML index. Without this guard, NVIDIA cards that show up
            // twice in the GPU map — once from NVML and once from Vulkan
            // enumeration with mismatched UUIDs (a documented NVIDIA quirk:
            // NVML's CUDA UUID and Vulkan's VkPhysicalDeviceIDProperties
            // .deviceUUID are not guaranteed to be byte-identical) — would
            // call `get_usage_nvidia` on the Vulkan-sourced duplicate,
            // trip the `nvidia_info.is_none()` branch, and spam a
            // misleading `log::error!("called on non-NVIDIA GPU")` every
            // poll. See the 2026-05-27 ADR and the commands.rs dedup
            // comment for the wider story.
            Vendor::NVIDIA if self.nvidia_info.is_some() => self.get_usage_nvidia(),
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
