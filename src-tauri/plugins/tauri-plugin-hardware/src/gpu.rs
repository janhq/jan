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
            Vendor::NVIDIA => self.get_usage_nvidia(),
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
