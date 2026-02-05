use crate::vendor::{nvidia, vulkan};

#[test]
fn test_get_nvidia_gpus() {
    let gpus = nvidia::get_nvidia_gpus();
    for (i, gpu) in gpus.iter().enumerate() {
        println!("GPU {}:", i);
        println!("    {:?}", gpu);
        println!("    {:?}", gpu.get_usage());
    }
}

#[test]
fn test_get_vulkan_gpus() {
    let gpus = vulkan::get_vulkan_gpus();
    for (i, gpu) in gpus.iter().enumerate() {
        println!("GPU {}:", i);
        println!("    {:?}", gpu);
        println!("    {:?}", gpu.get_usage());
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[test]
fn test_get_vulkan_gpus_on_desktop() {
    let gpus = vulkan::get_vulkan_gpus();

    // Test that function returns without panicking on desktop platforms
    assert!(gpus.len() >= 0);

    // If GPUs are found, verify they have valid properties
    for (i, gpu) in gpus.iter().enumerate() {
        println!("Desktop GPU {}:", i);
        println!("    Name: {}", gpu.name);
        println!("    Vendor: {:?}", gpu.vendor);
        println!("    Total Memory: {} MB", gpu.total_memory);
        println!("    UUID: {}", gpu.uuid);
        println!("    Driver Version: {}", gpu.driver_version);

        // Verify that GPU properties are not empty/default values
        assert!(!gpu.name.is_empty(), "GPU name should not be empty");
        assert!(!gpu.uuid.is_empty(), "GPU UUID should not be empty");

        // Test vulkan-specific info is present
        if let Some(vulkan_info) = &gpu.vulkan_info {
            println!("    Vulkan API Version: {}", vulkan_info.api_version);
            println!("    Device Type: {}", vulkan_info.device_type);
            assert!(!vulkan_info.api_version.is_empty(), "Vulkan API version should not be empty");
            assert!(!vulkan_info.device_type.is_empty(), "Device type should not be empty");
        }
    }
}

#[cfg(target_os = "android")]
#[test]
fn test_get_vulkan_gpus_on_android() {
    let gpus = vulkan::get_vulkan_gpus();

    // Test that function returns without panicking on Android
    assert!(gpus.len() >= 0);

    // Android-specific validation
    for (i, gpu) in gpus.iter().enumerate() {
        println!("Android GPU {}:", i);
        println!("    Name: {}", gpu.name);
        println!("    Vendor: {:?}", gpu.vendor);
        println!("    Total Memory: {} MB", gpu.total_memory);
        println!("    UUID: {}", gpu.uuid);
        println!("    Driver Version: {}", gpu.driver_version);

        // Verify C string parsing works correctly with i8 on Android
        assert!(!gpu.name.is_empty(), "GPU name should not be empty on Android");
        assert!(!gpu.uuid.is_empty(), "GPU UUID should not be empty on Android");

        // Android devices should typically have Adreno, Mali, or PowerVR GPUs
        // The name parsing should handle i8 char arrays correctly
        assert!(
            gpu.name.chars().all(|c| c.is_ascii() || c.is_ascii_control()),
            "GPU name should contain valid characters when parsed from i8 array"
        );

        if let Some(vulkan_info) = &gpu.vulkan_info {
            println!("    Vulkan API Version: {}", vulkan_info.api_version);
            println!("    Device Type: {}", vulkan_info.device_type);
            // Verify API version parsing works with Android's i8 char arrays
            assert!(
                vulkan_info.api_version.matches('.').count() >= 2,
                "API version should be in format X.Y.Z"
            );
        }
    }
}

#[cfg(target_os = "ios")]
#[test]
fn test_get_vulkan_gpus_on_ios() {
    let gpus = vulkan::get_vulkan_gpus();

    // Note: iOS doesn't support Vulkan natively, so this might return empty
    // But the function should still work without crashing
    assert!(gpus.len() >= 0);

    // iOS-specific validation (if any Vulkan implementation is available via MoltenVK)
    for (i, gpu) in gpus.iter().enumerate() {
        println!("iOS GPU {}:", i);
        println!("    Name: {}", gpu.name);
        println!("    Vendor: {:?}", gpu.vendor);
        println!("    Total Memory: {} MB", gpu.total_memory);
        println!("    UUID: {}", gpu.uuid);
        println!("    Driver Version: {}", gpu.driver_version);

        // Verify C string parsing works correctly with i8 on iOS
        assert!(!gpu.name.is_empty(), "GPU name should not be empty on iOS");
        assert!(!gpu.uuid.is_empty(), "GPU UUID should not be empty on iOS");

        // iOS devices should typically have Apple GPU (if Vulkan is available via MoltenVK)
        // The name parsing should handle i8 char arrays correctly
        assert!(
            gpu.name.chars().all(|c| c.is_ascii() || c.is_ascii_control()),
            "GPU name should contain valid characters when parsed from i8 array"
        );

        if let Some(vulkan_info) = &gpu.vulkan_info {
            println!("    Vulkan API Version: {}", vulkan_info.api_version);
            println!("    Device Type: {}", vulkan_info.device_type);
            // Verify API version parsing works with iOS's i8 char arrays
            assert!(
                vulkan_info.api_version.matches('.').count() >= 2,
                "API version should be in format X.Y.Z"
            );
        }
    }
}
