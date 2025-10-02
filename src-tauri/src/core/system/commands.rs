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
// - Windows: Checks build version (17134+ for acrylic support)
// - Linux: Checks for KWin (KDE) or compositor with blur support
// - macOS: Always supported
#[tauri::command]
pub fn supports_blur_effects() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows 10 build 17134 (1803) and later support acrylic effects
        // Windows 11 (build 22000+) has better support
        use std::process::Command;

        if let Ok(output) = Command::new("cmd")
            .args(&["/C", "ver"])
            .output()
        {
            if let Ok(version_str) = String::from_utf8(output.stdout) {
                // Parse Windows version from output like "Microsoft Windows [Version 10.0.22631.4602]"
                if let Some(version_part) = version_str.split("Version ").nth(1) {
                    if let Some(build_str) = version_part.split('.').nth(2) {
                        if let Ok(build) = build_str.split(']').next().unwrap_or("0").trim().parse::<u32>() {
                            // Windows 10 build 17134+ or Windows 11 build 22000+ support blur
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
        }

        // If we can't detect version, assume it doesn't support blur for safety
        log::warn!("❌ Could not detect Windows version - Assuming NO blur support for safety");
        false
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        // Check for KDE Plasma with KWin (best blur support)
        if let Ok(output) = Command::new("kwin_x11").arg("--version").output() {
            if output.status.success() {
                log::info!("✅ KDE/KWin detected - Blur effects SUPPORTED");
                return true;
            }
        }

        // Check for Wayland KWin
        if let Ok(output) = Command::new("kwin_wayland").arg("--version").output() {
            if output.status.success() {
                log::info!("✅ KDE/KWin Wayland detected - Blur effects SUPPORTED");
                return true;
            }
        }

        // Check for GNOME with blur extensions (less reliable)
        if std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().contains("GNOME") {
            log::info!("🔍 GNOME detected - Blur support depends on extensions");
            // GNOME might have blur through extensions, allow it
            return true;
        }

        // Check for Compiz (older but has blur)
        if let Ok(_) = Command::new("compiz").arg("--version").output() {
            log::info!("✅ Compiz compositor detected - Blur effects SUPPORTED");
            return true;
        }

        // Check for Picom with blur (common X11 compositor)
        if let Ok(output) = Command::new("picom").arg("--version").output() {
            if output.status.success() {
                log::info!("✅ Picom compositor detected - Blur effects SUPPORTED");
                return true;
            }
        }

        // Check environment variable for compositor
        if let Ok(compositor) = std::env::var("COMPOSITOR") {
            log::info!("🔍 Compositor detected: {} - Assuming blur support", compositor);
            return true;
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
