use vulkano::{
    instance::{Instance, InstanceCreateInfo},
    memory::MemoryHeapFlags,
    VulkanLibrary,
};

#[derive(Debug)]
pub struct VulkanInfo {
    name: String,
    index: u64,
    memory: super::MemoryInfo,
    vendor: String,
    uuid: String,
    driver_version: String,
    // Vulkan-specific info
    device_type: String,
    api_version: String,
    device_id: u32, // remove this?
}

impl From<VulkanInfo> for super::GpuInfo {
    fn from(val: VulkanInfo) -> Self {
        super::GpuInfo {
            name: val.name,
            index: val.index,
            memory: val.memory,
            vendor: val.vendor,
            uuid: val.uuid,
            driver_version: val.driver_version,
        }
    }
}

// https://devicehunt.com/all-pci-vendors
const VENDOR_ID_AMD: u32 = 0x1002;
const VENDOR_ID_NVIDIA: u32 = 0x10DE;
const VENDOR_ID_INTEL: u32 = 0x8086;

fn parse_vendor_id(vendor_id: u32) -> String {
    match vendor_id {
        VENDOR_ID_AMD => "AMD".to_string(),
        VENDOR_ID_NVIDIA => "NVIDIA".to_string(),
        VENDOR_ID_INTEL => "Intel".to_string(),
        _ => format!("Unknown. vendor_id: {vendor_id:#X}"),
    }
}

fn parse_uuid(bytes: &[u8; 16]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}-\
         {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

pub fn get_vulkan_gpus() -> Vec<VulkanInfo> {
    match get_vulkan_gpus_internal() {
        Ok(gpus) => gpus,
        Err(e) => {
            log::error!("Failed to get Vulkan GPUs: {:?}", e);
            vec![]
        }
    }
}

fn get_vulkan_gpus_internal() -> Result<Vec<VulkanInfo>, Box<dyn std::error::Error>> {
    let library = VulkanLibrary::new()?;
    let instance = Instance::new(library, InstanceCreateInfo::default())?;

    let mut device_info_list = vec![];
    for (i, device) in instance.enumerate_physical_devices()?.enumerate() {
        let total_memory = device
            .memory_properties()
            .memory_heaps
            .iter()
            // Vulkan may include host (CPU) memory
            .filter(|heap| heap.flags.contains(MemoryHeapFlags::DEVICE_LOCAL))
            .map(|heap| heap.size)
            .sum::<u64>()
            / (1024 * 1024); // convert to MiB

        // TODO: used memory, we can use heap_budget. but it seems like vulkano does not expose it

        let props = device.properties();
        let device_info = VulkanInfo {
            name: props.device_name.clone(),
            index: i as u64, // do we need this?
            memory: super::MemoryInfo {
                total: total_memory,
                used: 0,
            },
            vendor: parse_vendor_id(props.vendor_id),
            uuid: props
                .device_uuid
                .map(|bytes| parse_uuid(&bytes))
                .unwrap_or_default(),
            device_type: format!("{:?}", props.device_type),
            device_id: props.device_id,
            driver_version: props.driver_info.clone().unwrap_or_default(),
            api_version: format!(
                "{}.{}.{}",
                props.api_version.major, props.api_version.minor, props.api_version.patch
            ),
        };
        device_info_list.push(device_info);
    }

    Ok(device_info_list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_vulkan_gpus() {
        let gpus = get_vulkan_gpus();
        println!("Found {} GPU(s):", gpus.len());
        for (i, gpu) in gpus.iter().enumerate() {
            println!("GPU {}: {:?}", i, gpu);
        }
    }
}
