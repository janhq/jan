// default implementation
#[cfg(not(target_os = "linux"))]
#[cfg(not(target_os = "windows"))]
pub fn get_amd_gpus_memory_usage() -> Vec<super::MemoryUsage> {
    vec![]
}

// TODO: add matching logic
// /device/device is the same as Vulkan deviceId
#[cfg(target_os = "linux")]
pub fn get_amd_gpus_memory_usage() -> Vec<super::MemoryUsage> {
    use std::fs;
    use std::path::Path;

    let mut result = Vec::new();

    for card_idx in 0.. {
        let device_path = format!("/sys/class/drm/card{}/device", card_idx);
        if !Path::new(&device_path).exists() {
            break;
        }

        // Check if this is an AMD GPU by looking for amdgpu directory
        let amdgpu_path = format!("{}/driver/module/drivers/pci:amdgpu", device_path);
        if !Path::new(&amdgpu_path).exists() {
            continue;
        }

        let read_mem = |path: &str| -> u64 {
            fs::read_to_string(path)
                .map(|content| content.trim().parse::<u64>().unwrap_or(0))
                .unwrap_or(0)
                / 1024
                / 1024 // Convert bytes to MiB
        };
        result.push(super::MemoryUsage {
            total_memory: read_mem(&format!("{}/mem_info_vram_total", device_path)),
            used_memory: read_mem(&format!("{}/mem_info_vram_used", device_path)),
        });
    }

    result
}

// TODO: add matching logic
#[cfg(target_os = "windows")]
pub fn get_amd_gpus_memory_usage() -> Vec<super::MemoryUsage> {
    use libloading::{Library, Symbol};
    use std::ffi::c_void;
    use std::mem::{size_of, MaybeUninit};

    // ADL function types
    type AdlMainControlCreate = unsafe extern "C" fn(i32) -> *mut c_void;
    type AdlMainControlDestroy = unsafe extern "C" fn();
    type AdlAdapterNumberofadaptersGet = unsafe extern "C" fn(*mut i32) -> i32;
    type AdlAdapterMemoryinfoGet = unsafe extern "C" fn(i32, *mut ADLMemoryInfo) -> i32;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct ADLMemoryInfo {
        iSize: i32,
        iLocalMemory: i32,
        iMemoryBandwidth: i32,
        iMemoryUsed: i32,
    }

    let mut result = Vec::new();

    unsafe {
        // Load ADL library
        let lib = Library::new("atiadlxx.dll").or_else(|_| Library::new("atiadlxy.dll"));
        let lib = match lib {
            Ok(lib) => lib,
            Err(_) => return result,
        };

        // Get function pointers
        let adl_create: Symbol<AdlMainControlCreate> = match lib.get(b"ADL_Main_Control_Create") {
            Ok(func) => func,
            Err(_) => return result,
        };

        let adl_destroy: Symbol<AdlMainControlDestroy> = match lib.get(b"ADL_Main_Control_Destroy")
        {
            Ok(func) => func,
            Err(_) => return result,
        };

        let adl_get_num_adapters: Symbol<AdlAdapterNumberofadaptersGet> =
            match lib.get(b"ADL_Adapter_NumberOfAdapters_Get") {
                Ok(func) => func,
                Err(_) => return result,
            };

        let adl_get_memory_info: Symbol<AdlAdapterMemoryinfoGet> =
            match lib.get(b"ADL_Adapter_MemoryInfo_Get") {
                Ok(func) => func,
                Err(_) => return result,
            };

        // Initialize ADL
        adl_create(1);

        // Get number of adapters
        let mut num_adapters = 0;
        if adl_get_num_adapters(&mut num_adapters) == 0 {
            // For each adapter, get memory info
            for i in 0..num_adapters {
                let mut mem_info = MaybeUninit::<ADLMemoryInfo>::zeroed().assume_init();
                mem_info.iSize = size_of::<ADLMemoryInfo>() as i32;

                if adl_get_memory_info(i, &mut mem_info) == 0 {
                    result.push(super::MemoryUsage {
                        total_memory: mem_info.iLocalMemory as u64,
                        used_memory: mem_info.iMemoryUsed as u64,
                    });
                }
            }
        }

        // Clean up
        adl_destroy();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_amd_gpus_memory_usage() {
        let result = get_amd_gpus_memory_usage();
        for (i, usage) in result.iter().enumerate() {
            println!(
                "GPU {}: {} MiB / {} MiB",
                i, usage.used_memory, usage.total_memory
            );
        }
    }
}
