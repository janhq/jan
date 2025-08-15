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
    let gpus = vulkan::get_vulkan_gpus("");
    for (i, gpu) in gpus.iter().enumerate() {
        println!("GPU {}:", i);
        println!("    {:?}", gpu);
        println!("    {:?}", gpu.get_usage());
    }
}
