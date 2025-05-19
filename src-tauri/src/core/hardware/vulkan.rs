use vulkano::{
    instance::{Instance, InstanceCreateInfo},
    VulkanLibrary,
};

#[derive(Debug)]
pub struct VulkanInfo {
    name: String,
    index: u64,
    memory: super::MemoryInfo,
    vendor_id: u32, // change this to vendor string
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
            vendor: super::GpuVendor::Unknown,
            uuid: val.uuid,
            driver_version: val.driver_version,
        }
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
            .map(|heap| heap.size)
            .sum::<u64>() / (1024 * 1024); // convert to MiB

        let properties = device.properties();

        let device_info = VulkanInfo {
            name: properties.device_name.clone(),
            index: i as u64, // do we need this?
            uuid: properties
                .device_uuid
                .map(|bytes| parse_uuid(&bytes))
                .unwrap_or_default(),
            device_type: format!("{:?}", properties.device_type),
            // TODO: look up vendor_id and device_id
            vendor_id: properties.vendor_id,
            device_id: properties.device_id,
            // TODO: where is this from?
            driver_version: format!(
                "{}.{}.{}",
                properties.driver_version >> 22,
                (properties.driver_version >> 12) & 0x3ff,
                properties.driver_version & 0xfff
            ),
            api_version: format!(
                "{}.{}.{}",
                properties.api_version.major,
                properties.api_version.minor,
                properties.api_version.patch
            ),
            memory: super::MemoryInfo {
                total: total_memory,
                used: 0, // TODO: implement this
            },
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
