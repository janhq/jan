use crate::types::{GpuInfo, GpuUsage};

impl GpuInfo {
    #[cfg(not(target_os = "linux"))]
    #[cfg(not(target_os = "windows"))]
    pub fn get_usage_amd(&self) -> GpuUsage {
        self.get_usage_unsupported()
    }

    #[cfg(target_os = "linux")]
    pub fn get_usage_amd(&self) -> GpuUsage {
        use std::fs;
        use std::path::Path;

        let device_id = match &self.vulkan_info {
            Some(vulkan_info) => vulkan_info.device_id,
            None => {
                log::error!("get_usage_amd called without Vulkan info");
                return self.get_usage_unsupported();
            }
        };

        let closure = || -> Result<GpuUsage, Box<dyn std::error::Error>> {
            for subdir in fs::read_dir("/sys/class/drm")? {
                let device_path = subdir?.path().join("device");

                // Check if this is an AMD GPU by looking for amdgpu directory
                if !device_path
                    .join("driver/module/drivers/pci:amdgpu")
                    .exists()
                {
                    continue;
                }

                // match device_id from Vulkan info
                let this_device_id_str = fs::read_to_string(device_path.join("device"))?;
                let this_device_id = u32::from_str_radix(
                    this_device_id_str
                        .strip_prefix("0x")
                        .unwrap_or(&this_device_id_str)
                        .trim(),
                    16,
                )?;
                if this_device_id != device_id {
                    continue;
                }

                let read_mem = |path: &Path| -> u64 {
                    fs::read_to_string(path)
                        .map(|content| content.trim().parse::<u64>().unwrap_or(0))
                        .unwrap_or(0)
                        / 1024
                        / 1024 // Convert bytes to MiB
                };
                return Ok(GpuUsage {
                    uuid: self.uuid.clone(),
                    total_memory: read_mem(&device_path.join("mem_info_vram_total")),
                    used_memory: read_mem(&device_path.join("mem_info_vram_used")),
                });
            }
            Err(format!("GPU not found").into())
        };

        match closure() {
            Ok(usage) => usage,
            Err(e) => {
                log::error!(
                    "Failed to get memory usage for AMD GPU {:#x}: {}",
                    device_id,
                    e
                );
                self.get_usage_unsupported()
            }
        }
    }

    #[cfg(target_os = "windows")]
    pub fn get_usage_amd(&self) -> GpuUsage {
        use std::collections::HashMap;

        let memory_usage_map = windows_impl::get_gpu_usage().unwrap_or_else(|_| {
            log::error!("Failed to get AMD GPU memory usage");
            HashMap::new()
        });

        match memory_usage_map.get(&self.name) {
            Some(&used_memory) => GpuUsage {
                uuid: self.uuid.clone(),
                used_memory: used_memory as u64,
                total_memory: self.total_memory,
            },
            None => self.get_usage_unsupported(),
        }
    }
}

// TODO: refactor this into a more egonomic API
#[cfg(target_os = "windows")]
mod windows_impl {
    use libc;
    use libloading::{Library, Symbol};
    use std::collections::HashMap;
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::mem::{self, MaybeUninit};
    use std::ptr;

    // === FFI Struct Definitions ===
    #[repr(C)]
    #[allow(non_snake_case)]
    #[derive(Debug, Copy, Clone)]
    pub struct AdapterInfo {
        pub iSize: c_int,
        pub iAdapterIndex: c_int,
        pub strUDID: [c_char; 256],
        pub iBusNumber: c_int,
        pub iDeviceNumber: c_int,
        pub iFunctionNumber: c_int,
        pub iVendorID: c_int,
        pub strAdapterName: [c_char; 256],
        pub strDisplayName: [c_char; 256],
        pub iPresent: c_int,
        pub iExist: c_int,
        pub strDriverPath: [c_char; 256],
        pub strDriverPathExt: [c_char; 256],
        pub strPNPString: [c_char; 256],
        pub iOSDisplayIndex: c_int,
    }

    type AdlMainMallocCallback = Option<unsafe extern "C" fn(i32) -> *mut c_void>;
    type ADLMAINCONTROLCREATE = unsafe extern "C" fn(AdlMainMallocCallback, c_int) -> c_int;
    type ADLMAINCONTROLDESTROY = unsafe extern "C" fn() -> c_int;
    type AdlAdapterNumberofadaptersGet = unsafe extern "C" fn(*mut c_int) -> c_int;
    type AdlAdapterAdapterinfoGet = unsafe extern "C" fn(*mut AdapterInfo, c_int) -> c_int;
    type AdlAdapterActiveGet = unsafe extern "C" fn(c_int, *mut c_int) -> c_int;
    type AdlGetDedicatedVramUsage =
        unsafe extern "C" fn(*mut c_void, c_int, *mut c_int) -> c_int;

    // === ADL Memory Allocator ===
    unsafe extern "C" fn adl_malloc(i_size: i32) -> *mut c_void {
        libc::malloc(i_size as usize)
    }

    pub fn get_gpu_usage() -> Result<HashMap<String, i32>, Box<dyn std::error::Error>> {
        unsafe {
            let lib = Library::new("atiadlxx.dll").or_else(|_| Library::new("atiadlxy.dll"))?;

            let adlmaincontrolcreate: Symbol<ADLMAINCONTROLCREATE> =
                lib.get(b"AdlMainControlCreate")?;
            let adlmaincontroldestroy: Symbol<ADLMAINCONTROLDESTROY> =
                lib.get(b"AdlMainControlDestroy")?;
            let adl_adapter_number_of_adapters_get: Symbol<AdlAdapterNumberofadaptersGet> =
                lib.get(b"AdlAdapterNumberofadaptersGet")?;
            let adl_adapter_adapter_info_get: Symbol<AdlAdapterAdapterinfoGet> =
                lib.get(b"AdlAdapterAdapterinfoGet")?;
            let AdlAdapterActiveGet: Symbol<AdlAdapterActiveGet> =
                lib.get(b"AdlAdapterActiveGet")?;
            let AdlGetDedicatedVramUsage: Symbol<AdlGetDedicatedVramUsage> =
                lib.get(b"ADL2_Adapter_DedicatedVRAMUsage_Get")?;

            // TODO: try to put nullptr here. then we don't need direct libc dep
            if adlmaincontrolcreate(Some(adl_malloc), 1) != 0 {
                return Err("ADL initialization error!".into());
            }
            // NOTE: after this call, we must call AdlMainControlDestroy
            // whenver we encounter an error

            let mut num_adapters: c_int = 0;
            if adl_adapter_number_of_adapters_get(&mut num_adapters as *mut _) != 0 {
                return Err("Cannot get number of adapters".into());
            }

            let mut vram_usages = HashMap::new();

            if num_adapters > 0 {
                let mut adapter_info: Vec<AdapterInfo> =
                    vec![MaybeUninit::zeroed().assume_init(); num_adapters as usize];
                let ret = adl_adapter_adapter_info_get(
                    adapter_info.as_mut_ptr(),
                    mem::size_of::<AdapterInfo>() as i32 * num_adapters,
                );
                if ret != 0 {
                    return Err("Cannot get adapter info".into());
                }

                for adapter in adapter_info.iter() {
                    let mut is_active = 0;
                    AdlAdapterActiveGet(adapter.iAdapterIndex, &mut is_active);

                    if is_active != 0 {
                        let mut vram_mb = 0;
                        let _ = AdlGetDedicatedVramUsage(
                            ptr::null_mut(),
                            adapter.iAdapterIndex,
                            &mut vram_mb,
                        );
                        // NOTE: adapter name might not be unique?
                        let name = CStr::from_ptr(adapter.strAdapterName.as_ptr())
                            .to_string_lossy()
                            .into_owned();
                        vram_usages.insert(name, vram_mb);
                    }
                }
            }

            adlmaincontroldestroy();

            Ok(vram_usages)
        }
    }
}
