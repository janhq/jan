use tauri::{path::BaseDirectory, Manager, Runtime};

pub fn get_jan_libvulkan_path<R: Runtime>(app: tauri::AppHandle<R>) -> String {
    let lib_name = if cfg!(target_os = "windows") {
        "vulkan-1.dll"
    } else if cfg!(target_os = "linux") {
        "libvulkan.so"
    } else {
        return "".to_string();
    };

    // NOTE: this does not work in test mode (mock app)
    match app.path().resolve(
        format!("resources/lib/{}", lib_name),
        BaseDirectory::Resource,
    ) {
        Ok(lib_path) => lib_path.to_string_lossy().to_string(),
        Err(_) => "".to_string(),
    }
}
