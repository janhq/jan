use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_jan_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::clean_up_mcp_servers;
use crate::core::state::AppState;

#[tauri::command]
pub fn factory_reset<R: Runtime>(app_handle: tauri::AppHandle<R>, state: State<'_, AppState>) {
    // close window (not available on mobile platforms)
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let windows = app_handle.webview_windows();
        for (label, window) in windows.iter() {
            window.close().unwrap_or_else(|_| {
                log::warn!("Failed to close window: {label:?}");
            });
        }
    }
    let data_folder = get_jan_data_folder_path(app_handle.clone());
    log::info!("Factory reset, removing data folder: {data_folder:?}");

    tauri::async_runtime::block_on(async {
        clean_up_mcp_servers(state.clone()).await;
        let _ = cleanup_llama_processes(app_handle.clone()).await;

        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                log::error!("Failed to remove data folder: {e}");
                return;
            }
        }

        // Recreate the data folder
        let _ = fs::create_dir_all(&data_folder).map_err(|e| e.to_string());

        // Reset the configuration
        let mut default_config = AppConfiguration::default();
        default_config.data_folder = default_data_folder_path(app_handle.clone());
        let _ = update_app_configuration(app_handle.clone(), default_config);

        app_handle.restart();
    });
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory<R: Runtime>(app: AppHandle<R>) {
    let app_path = app.path().app_data_dir().unwrap();
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    } else {
        std::process::Command::new("xdg-open")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    }
}

#[tauri::command]
pub fn open_file_explorer(path: String) {
    let path = PathBuf::from(path);
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    } else {
        std::process::Command::new("xdg-open")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    }
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_jan_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    match unsafe { libloading::Library::new(library) } {
        Ok(_) => true,
        Err(e) => {
            log::info!("Library {library} is not available: {e}");
            false
        }
    }
}

// Check if the system supports blur/acrylic effects
// - Windows: Checks build version from OS info (17134+ for acrylic support)
// - Linux: Checks for KWin (KDE) or compositor with blur support via environment variables
// - macOS: Always supported
#[tauri::command]
pub fn supports_blur_effects() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows 10 build 17134 (1803) and later support acrylic effects
        // Windows 11 (build 22000+) has better support
        #[cfg(feature = "hardware")]
        {
            use tauri_plugin_hardware::get_system_info;

            let system_info = get_system_info();
            // os_name format: "Windows 10 Pro (build 22631)"
            if let Some(build_str) = system_info.os_name.split("build ").nth(1) {
                if let Some(build_num) = build_str.split(')').next() {
                    if let Ok(build) = build_num.trim().parse::<u32>() {
                        let supports_blur = build >= 17134;
                        if supports_blur {
                            log::info!("✅ Windows build {} detected - Blur/Acrylic effects SUPPORTED", build);
                        } else {
                            log::warn!("❌ Windows build {} detected - Blur/Acrylic effects NOT SUPPORTED (requires build 17134+)", build);
                        }
                        return supports_blur;
                    }
                }
            }
        }

        // Fallback: If hardware feature is disabled or parsing fails, assume modern Windows
        log::info!("✅ Windows detected - Assuming modern build with blur support");
        true
    }

    #[cfg(target_os = "linux")]
    {
        // Check desktop environment via environment variables
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
        let session = std::env::var("XDG_SESSION_DESKTOP").unwrap_or_default().to_lowercase();

        // KDE Plasma with KWin (best blur support)
        if desktop.contains("kde") || session.contains("kde") || session.contains("plasma") {
            log::info!("✅ KDE/KWin detected - Blur effects SUPPORTED");
            return true;
        }

        // GNOME with blur extensions (conditional support)
        if desktop.contains("gnome") || session.contains("gnome") {
            log::info!("🔍 GNOME detected - Blur support depends on extensions");
            return true;
        }

        // Check for compositor via environment variable
        if let Ok(compositor) = std::env::var("COMPOSITOR") {
            let comp_lower = compositor.to_lowercase();
            if comp_lower.contains("kwin") || comp_lower.contains("picom") || comp_lower.contains("compiz") {
                log::info!("✅ Compositor detected: {} - Blur effects SUPPORTED", compositor);
                return true;
            }
        }

        // Check wayland/X11 session type (Wayland typically has better compositor support)
        if let Ok(session_type) = std::env::var("XDG_SESSION_TYPE") {
            if session_type == "wayland" {
                log::info!("🔍 Wayland session detected - Likely blur support available");
                return true;
            }
        }

        log::warn!("❌ No known blur-capable compositor detected on Linux");
        false
    }

    #[cfg(target_os = "macos")]
    {
        // macOS always supports blur/vibrancy effects
        log::info!("✅ macOS detected - Blur/Vibrancy effects SUPPORTED");
        true
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        log::warn!("❌ Unknown platform - Assuming NO blur support");
        false
    }
}
