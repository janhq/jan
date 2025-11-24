use crate::types::GpuInfo;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use {
    crate::types::Vendor,
    vulkano::device::physical::PhysicalDeviceType,
    vulkano::instance::{Instance, InstanceCreateInfo},
    vulkano::memory::MemoryHeapFlags,
    vulkano::VulkanLibrary,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct VulkanInfo {
    pub index: u64,
    pub device_type: String,
    pub api_version: String,
    pub device_id: u32,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

pub fn get_vulkan_gpus() -> Vec<GpuInfo> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        log::info!("Vulkan GPU detection is not supported on mobile platforms");
        vec![]
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        match get_vulkan_gpus_internal() {
            Ok(gpus) => gpus,
            Err(e) => {
                log::error!("Failed to get Vulkan GPUs: {:?}", e);
                vec![]
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_vulkan_gpus_internal() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    let library = VulkanLibrary::new()?;

    let instance = Instance::new(
        library,
        InstanceCreateInfo {
            application_name: Some("Jan GPU Detection".into()),
            application_version: vulkano::Version::V1_1,
            ..Default::default()
        },
    )?;

    let mut device_info_list = vec![];

    for (i, physical_device) in instance.enumerate_physical_devices()?.enumerate() {
        let properties = physical_device.properties();

        if properties.device_type == PhysicalDeviceType::Cpu {
            continue;
        }

        let memory_properties = physical_device.memory_properties();
        let total_memory: u64 = memory_properties
            .memory_heaps
            .iter()
            .filter(|heap| heap.flags.intersects(MemoryHeapFlags::DEVICE_LOCAL))
            .map(|heap| heap.size / (1024 * 1024))
            .sum();

        let device_uuid = physical_device.properties().device_uuid.unwrap_or([0; 16]);
        let driver_version = format!("{}", properties.driver_version);

        let device_info = GpuInfo {
            name: properties.device_name.clone(),
            total_memory,
            vendor: Vendor::from_vendor_id(properties.vendor_id),
            uuid: parse_uuid(&device_uuid),
            driver_version,
            nvidia_info: None,
            vulkan_info: Some(VulkanInfo {
                index: i as u64,
                device_type: format!("{:?}", properties.device_type),
                api_version: format!(
                    "{}.{}.{}",
                    properties.api_version.major,
                    properties.api_version.minor,
                    properties.api_version.patch
                ),
                device_id: properties.device_id,
            }),
        };
        device_info_list.push(device_info);
    }

    Ok(device_info_list)
}
