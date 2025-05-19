use ash::{vk, Entry};

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

fn parse_c_string(buf: &[i8]) -> String {
    unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }
        .to_str()
        .unwrap_or_default()
        .to_string()
}

fn get_vulkan_gpus_internal() -> Result<Vec<VulkanInfo>, Box<dyn std::error::Error>> {
    // let entry = unsafe { Entry::load()? };
    let entry =
        unsafe { Entry::load_from("/opt/homebrew/Cellar/molten-vk/1.3.0/lib/libMoltenVK.dylib")? };
    let app_info = vk::ApplicationInfo {
        api_version: vk::make_api_version(0, 1, 1, 0),
        ..Default::default()
    };
    let create_info = vk::InstanceCreateInfo {
        p_application_info: &app_info,
        ..Default::default()
    };
    let instance = unsafe { entry.create_instance(&create_info, None)? };

    let mut device_info_list = vec![];

    for (i, device) in unsafe { instance.enumerate_physical_devices()? }
        .iter()
        .enumerate()
    {
        // create a chain of properties struct for VkPhysicalDeviceProperties2(3)
        // https://registry.khronos.org/vulkan/specs/latest/man/html/VkPhysicalDeviceProperties2.html
        // props2 -> driver_props -> id_props -> memory_props
        let mut mem_props = vk::PhysicalDeviceMemoryBudgetPropertiesEXT::default();
        let mut id_props = vk::PhysicalDeviceIDProperties {
            p_next: &mut mem_props as *mut _ as *mut std::ffi::c_void,
            ..Default::default()
        };
        let mut driver_props = vk::PhysicalDeviceDriverProperties {
            p_next: &mut id_props as *mut _ as *mut std::ffi::c_void,
            ..Default::default()
        };
        let mut props2 = vk::PhysicalDeviceProperties2 {
            p_next: &mut driver_props as *mut _ as *mut std::ffi::c_void,
            ..Default::default()
        };
        unsafe {
            instance.get_physical_device_properties2(*device, &mut props2);
        }

        let props = props2.properties;
        if props.device_type == vk::PhysicalDeviceType::CPU {
            continue;
        }

        let mut memory_info = super::MemoryInfo { total: 0, used: 0 };
        for (heap_idx, heap) in unsafe { instance.get_physical_device_memory_properties(*device) }
            .memory_heaps
            .iter()
            .enumerate()
        {
            if heap.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL) {
                memory_info.total += heap.size / (1024 * 1024); // convert to MiB
                memory_info.used += mem_props.heap_usage[heap_idx] / (1024 * 1024);
            }
        }

        let device_info = VulkanInfo {
            name: parse_c_string(&props.device_name),
            index: i as u64, // do we need this?
            memory: memory_info,
            vendor: parse_vendor_id(props.vendor_id),
            uuid: parse_uuid(&id_props.device_uuid),
            device_type: format!("{:?}", props.device_type),
            device_id: props.device_id,
            driver_version: parse_c_string(&driver_props.driver_info),
            api_version: format!(
                "{}.{}.{}",
                vk::api_version_major(props.api_version),
                vk::api_version_minor(props.api_version),
                vk::api_version_patch(props.api_version)
            ),
        };
        device_info_list.push(device_info);
    }

    unsafe { instance.destroy_instance(None) };

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
