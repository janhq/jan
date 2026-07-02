use flate2::read::GzDecoder;
use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tar::Archive;
use tauri::{App, AppHandle, Emitter, Listener, Manager, Runtime, WindowEvent, Wry};

#[cfg(feature = "desktop")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::Store;

use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::mcp::constants::DEFAULT_MCP_CONFIG;
use crate::core::mcp::helpers::add_server_config;

use super::{
    extensions::commands::get_jan_extensions_path, mcp::helpers::run_mcp_commands, state::AppState,
};

pub fn install_extensions<R: Runtime>(app: tauri::AppHandle<R>, force: bool) -> Result<(), String> {
    // Skip extension installation on mobile platforms
    // Mobile uses pre-bundled extensions loaded via MobileCoreService in the frontend
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Ok(());
    }

    let extensions_path = get_jan_extensions_path(app.clone());
    let extensions_json_path = extensions_path.join("extensions.json");
    let pre_install_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not resolve resource dir: {e}"))?
        .join("resources")
        .join("pre-install");

    let mut clean_up = force;

    // Check IS_CLEAN environment variable to optionally skip extension install
    if std::env::var("IS_CLEAN").is_ok() {
        clean_up = true;
    }
    log::info!("Installing extensions. Clean up: {clean_up}");
    // A bare directory is not proof of a completed install; gate on the manifest
    // so a previously-aborted run self-heals on the next launch.
    if !clean_up && extensions_json_path.exists() {
        return Ok(());
    }

    // Validate the install source before mutating anything. A missing/unreadable
    // pre-install dir must not wipe a working install or leave a half-built one.
    let pre_install_entries = match fs::read_dir(&pre_install_path) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!(
                "Skipping extension install; pre-install dir unavailable at {pre_install_path:?}: {e}"
            );
            return Ok(());
        }
    };

    // Source is good — now it's safe to clear and recreate the target.
    if extensions_path.exists() {
        fs::remove_dir_all(&extensions_path).unwrap_or_else(|_| {
            log::info!("Failed to remove existing extensions folder, it may not exist.");
        });
    }
    if !extensions_path.exists() {
        fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
    }
    let mut extensions_list = if extensions_json_path.exists() {
        let existing_data =
            fs::read_to_string(&extensions_json_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str::<Vec<serde_json::Value>>(&existing_data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    for entry in pre_install_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "tgz") {
            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);

            let mut extension_name = None;
            let mut extension_manifest = None;
            extract_extension_manifest(&mut archive)
                .map_err(|e| e.to_string())
                .and_then(|manifest| match manifest {
                    Some(manifest) => {
                        extension_name = manifest["name"].as_str().map(|s| s.to_string());
                        extension_manifest = Some(manifest);
                        Ok(())
                    }
                    None => Err("Manifest is None".to_string()),
                })?;

            let extension_name = extension_name.ok_or("package.json not found in archive")?;
            let extension_dir = extensions_path.join(extension_name.clone());
            fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let file_path = entry.path().map_err(|e| e.to_string())?;
                let components: Vec<_> = file_path.components().collect();
                if components.len() > 1 {
                    let relative_path: PathBuf = components[1..].iter().collect();
                    let target_path = extension_dir.join(relative_path);
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let _result = entry.unpack(&target_path).map_err(|e| e.to_string())?;
                }
            }

            let main_entry = extension_manifest
                .as_ref()
                .and_then(|manifest| manifest["main"].as_str())
                .unwrap_or("index.js");
            let url = extension_dir.join(main_entry).to_string_lossy().to_string();

            let new_extension = serde_json::json!({
                "url": url,
                "name": extension_name.clone(),
                "origin": extension_dir.to_string_lossy(),
                "active": true,
                "description": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["description"].as_str())
                    .unwrap_or(""),
                "version": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["version"].as_str())
                    .unwrap_or(""),
                "productName": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["productName"].as_str())
                    .unwrap_or(""),
            });

            extensions_list.push(new_extension);

            log::info!("Installed extension to {extension_dir:?}");
        }
    }
    fs::write(
        &extensions_json_path,
        serde_json::to_string_pretty(&extensions_list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    let mcp_version = store
        .get("mcp_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if mcp_version < 1 {
        log::info!("Migrating MCP schema version 1");
        let result = add_server_config(
            app_handle.clone(),
            "exa".to_string(),
            serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    if mcp_version < 2 {
        log::info!("Migrating MCP schema version 2: Adding Jan Browser MCP");
        let result = add_server_config(
            app_handle.clone(),
            "Jan Browser MCP".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "search-mcp-server@latest"],
                "env": {
                    "BRIDGE_HOST": "127.0.0.1",
                    "BRIDGE_PORT": "17389"
                },
                "active": false,
                "official": true
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add Jan Browser MCP server config: {e}");
        }
    }
    if mcp_version < 3 {
        log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
        if let Err(e) = migrate_exa_to_http(app_handle) {
            log::error!("Failed to migrate Exa to HTTP: {e}");
        }
    }
    store.set("mcp_version", 3);
    store.save().expect("Failed to save store");
    Ok(())
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_jan_data_folder_path(app_handle).join("mcp_config.json");

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.insert(
            "exa".to_string(),
            serde_json::json!({
                "type": "http",
                "url": "https://mcp.exa.ai/mcp".to_string(),
                "command": "",
                "args": [],
                "env": {},
                "active": true
            }),
        );
    }

    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

pub fn extract_extension_manifest<R: Read>(
    archive: &mut Archive<R>,
) -> Result<Option<serde_json::Value>, String> {
    let entry = archive
        .entries()
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // Ignore errors in individual entries
        .find(|entry| {
            if let Ok(file_path) = entry.path() {
                let path_str = file_path.to_string_lossy();
                path_str == "package/package.json" || path_str == "package.json"
            } else {
                false
            }
        });

    if let Some(mut entry) = entry {
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;

        let package_json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

/// Install/update the bundled `jan` CLI binary.
///
/// - `version_changed`: pass `true` whenever the app version has changed (i.e. after an update).
///   When `true` the binary is always overwritten so the CLI stays in sync with the new app.
///   When `false` only installs if the binary is not yet present on PATH.
///
/// Runs in a background task — never blocks startup.
/// Errors are logged as warnings and never prevent the app from starting.
pub fn setup_jan_cli<R: Runtime>(app_handle: tauri::AppHandle<R>, version_changed: bool) {
    tauri::async_runtime::spawn(async move {
        // On a normal launch where the version hasn't changed, skip reinstall if already on PATH.
        if !version_changed {
            let which_cmd = if cfg!(windows) { "where" } else { "which" };
            let mut cmd = std::process::Command::new(which_cmd);
            cmd.arg("jan");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
                log::debug!("jan CLI already on PATH — skipping reinstall");
                return;
            }
        }

        match crate::core::system::commands::install_jan_cli_sync(&app_handle) {
            Ok(status) => {
                log::info!(
                    "jan CLI {} to {}",
                    if version_changed {
                        "updated"
                    } else {
                        "installed"
                    },
                    status.path.as_deref().unwrap_or("<unknown>")
                );
            }
            Err(e) => {
                log::warn!("jan CLI auto-install skipped: {e}");
            }
        }
    });
}

/// Resolve when the frontend emits `app-ready`, or after `timeout` (so a window
/// that never signals still proceeds).
async fn wait_for_app_ready<R: Runtime>(app: &AppHandle<R>, timeout: Duration) {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let handler = app.once_any("app-ready", move |_| {
        let _ = tx.send(());
    });
    if tokio::time::timeout(timeout, rx).await.is_err() {
        log::info!("app-ready not received within {timeout:?}; starting MCP servers anyway");
        app.unlisten(handler);
    }
}

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use crate::core::mcp::lockfile::cleanup_all_stale_locks;

        // Defer past first paint so npx/uvx spawns don't starve cold start.
        wait_for_app_ready(&app_handle, Duration::from_secs(30)).await;

        // Create default mcp_config.json if it doesn't exist
        let config_path = get_jan_data_folder_path(app_handle.clone()).join("mcp_config.json");
        if !config_path.exists() {
            log::info!("mcp_config.json not found, creating default config");
            if let Err(e) = fs::write(&config_path, DEFAULT_MCP_CONFIG) {
                log::error!("Failed to create default MCP config: {e}");
            }
        }

        if let Err(e) = cleanup_all_stale_locks(&app_handle).await {
            log::debug!("Lock file cleanup error: {}", e);
        }

        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {e}");
        }
        if let Err(e) = app_handle.emit("mcp-update", "MCP servers updated") {
            log::warn!("Failed to emit mcp-update event: {e}");
        }
    });
}

#[cfg(feature = "desktop")]
pub fn setup_tray(app: &App) -> tauri::Result<TrayIcon> {
    let show_i = MenuItem::with_id(app.handle(), "open", "Open Jan", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
    let separator_i = PredefinedMenuItem::separator(app.handle())?;
    let menu = Menu::with_items(app.handle(), &[&show_i, &separator_i, &quit_i])?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // let's show and focus the main window when the tray is clicked
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                log::debug!("unhandled event {event:?}");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let window = app.get_webview_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                println!("menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup GTK window theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    // On Linux, also listen to XDG Desktop Portal color-scheme changes via D-Bus.
    // This is needed because KDE Plasma and some other desktop environments
    // don't always update GTK settings when the system theme changes,
    // which means the GTK WindowEvent::ThemeChanged may never fire.
    #[cfg(target_os = "linux")]
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = setup_xdg_portal_theme_listener(app_handle).await {
                log::warn!("Failed to setup XDG Desktop Portal theme listener: {e}");
                log::warn!("System theme changes from KDE/non-GNOME DEs may not be detected");
            }
        });
    }

    Ok(())
}

/// Read the current XDG Desktop Portal `org.freedesktop.appearance/color-scheme`
/// setting. Returns "dark", "light", or `None` if the portal reports no preference
/// or is unavailable.
#[cfg(target_os = "linux")]
async fn read_xdg_portal_color_scheme() -> Result<Option<&'static str>, Box<dyn std::error::Error>>
{
    use zbus::Connection;

    let connection = Connection::session().await?;
    let proxy: zbus::Proxy<'_> = zbus::proxy::Builder::new(&connection)
        .destination("org.freedesktop.portal.Desktop")?
        .path("/org/freedesktop/portal/desktop")?
        .interface("org.freedesktop.portal.Settings")?
        .build()
        .await?;

    let reply: zbus::zvariant::OwnedValue = proxy
        .call("Read", &("org.freedesktop.appearance", "color-scheme"))
        .await?;

    let inner: zbus::zvariant::OwnedValue = match reply.downcast_ref::<zbus::zvariant::Value>() {
        Ok(v) => v.try_to_owned()?,
        Err(_) => reply,
    };
    let color_scheme = u32::try_from(inner).unwrap_or(0);
    // GNOME emits 0 ("no preference") for light, 1 for dark, 2 for explicit
    // light (rare). Treat 0 and 2 as light so light↔dark toggles work on both
    // GNOME and KDE/freedesktop-compliant DEs.
    Ok(match color_scheme {
        1 => Some("dark"),
        _ => Some("light"),
    })
}

/// Window-control placement split by side. Values are `"minimize"`,
/// `"maximize"`, `"close"`; the borderless frontend renders its own buttons in
/// this order so they match the desktop's configured layout.
#[derive(serde::Serialize)]
pub struct TitlebarLayout {
    pub left: Vec<String>,
    pub right: Vec<String>,
}

impl Default for TitlebarLayout {
    fn default() -> Self {
        TitlebarLayout {
            left: vec![],
            right: vec![
                "minimize".to_string(),
                "maximize".to_string(),
                "close".to_string(),
            ],
        }
    }
}

/// Read the desktop's window-button layout so the borderless titlebar can place
/// min/max/close on the side the user configured (KDE `kwinrc`, GNOME gsettings).
/// Falls back to all-on-the-right on non-Linux or when the config is unreadable.
#[tauri::command]
pub fn get_titlebar_layout() -> TitlebarLayout {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        let is_kde = desktop.split(':').any(|d| d.eq_ignore_ascii_case("KDE"));
        let layout = if is_kde {
            read_kde_button_layout()
        } else {
            read_gnome_button_layout()
        };
        if let Some(layout) = layout {
            return layout;
        }
    }
    TitlebarLayout::default()
}

/// Parse `~/.config/kwinrc` `[org.kde.kdecoration2]` button codes
/// (`I`=minimize, `A`=maximize, `X`=close; others ignored). Defaults match
/// KDE's own (`MS` left / `IAX` right) when the keys are absent.
#[cfg(target_os = "linux")]
fn read_kde_button_layout() -> Option<TitlebarLayout> {
    let home = std::env::var("HOME").ok()?;
    let content =
        fs::read_to_string(PathBuf::from(home).join(".config/kwinrc")).unwrap_or_default();

    let mut left = "MS".to_string();
    let mut right = "IAX".to_string();
    let mut in_section = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line == "[org.kde.kdecoration2]";
        } else if in_section {
            if let Some(v) = line.strip_prefix("ButtonsOnLeft=") {
                left = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("ButtonsOnRight=") {
                right = v.trim().to_string();
            }
        }
    }

    let codes = |s: &str| -> Vec<String> {
        s.chars()
            .filter_map(|c| match c {
                'I' => Some("minimize".to_string()),
                'A' => Some("maximize".to_string()),
                'X' => Some("close".to_string()),
                _ => None,
            })
            .collect()
    };
    Some(TitlebarLayout {
        left: codes(&left),
        right: codes(&right),
    })
}

/// Read GNOME's `button-layout` (`"appmenu:minimize,maximize,close"`); the side
/// before `:` is the left cluster. Unknown tokens (appmenu/icon/spacer) ignored.
#[cfg(target_os = "linux")]
fn read_gnome_button_layout() -> Option<TitlebarLayout> {
    let output = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.wm.preferences", "button-layout"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let raw = raw.trim().trim_matches('\'');
    let (left, right) = raw.split_once(':').unwrap_or(("", raw));

    let tokens = |s: &str| -> Vec<String> {
        s.split(',')
            .filter_map(|t| match t.trim() {
                "minimize" => Some("minimize".to_string()),
                "maximize" => Some("maximize".to_string()),
                "close" => Some("close".to_string()),
                _ => None,
            })
            .collect()
    };
    Some(TitlebarLayout {
        left: tokens(left),
        right: tokens(right),
    })
}

/// Flip GTK's `gtk-application-prefer-dark-theme` so the native Wayland
/// HeaderBar follows the app's effective theme (user override or system).
/// No-op on non-Linux.
#[tauri::command]
pub fn set_gtk_prefer_dark(dark: bool) {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        // GTK objects are not Send; bounce onto the GTK main thread.
        gtk::glib::MainContext::default().invoke(move || {
            if let Some(settings) = gtk::Settings::default() {
                settings.set_gtk_application_prefer_dark_theme(dark);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = dark;
    }
}

#[tauri::command]
pub async fn get_system_theme<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        match read_xdg_portal_color_scheme().await {
            Ok(Some(theme)) => return Ok(theme.to_string()),
            Ok(None) => {}
            Err(e) => log::warn!("get_system_theme: portal read failed: {e}"),
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(theme) = window.theme() {
            return Ok(match theme {
                tauri::Theme::Dark => "dark".to_string(),
                _ => "light".to_string(),
            });
        }
    }
    Ok("light".to_string())
}

/// Listen to the XDG Desktop Portal `org.freedesktop.appearance` `color-scheme`
/// setting via D-Bus. This fires reliably on KDE Plasma, GNOME, and other
/// freedesktop-compliant desktop environments.
#[cfg(target_os = "linux")]
async fn setup_xdg_portal_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    use futures_util::StreamExt;
    use zbus::Connection;

    let connection = Connection::session().await?;

    // Build a proxy for the XDG Desktop Portal Settings interface
    let proxy: zbus::Proxy<'_> = zbus::proxy::Builder::new(&connection)
        .destination("org.freedesktop.portal.Desktop")?
        .path("/org/freedesktop/portal/desktop")?
        .interface("org.freedesktop.portal.Settings")?
        .build()
        .await?;

    // Listen for all SettingChanged signals and filter for color-scheme
    let mut signal_stream = proxy.receive_signal("SettingChanged").await?;

    log::info!("XDG Desktop Portal theme listener active");

    // Emit the current value so the frontend doesn't have to wait for the first
    // SettingChanged signal to learn the system color-scheme on startup.
    match read_xdg_portal_color_scheme().await {
        Ok(Some(theme_str)) => {
            log::info!("XDG Portal: initial system color-scheme: {theme_str}");
            let _ = app_handle.emit("theme-changed", theme_str);
        }
        Ok(None) => log::info!("XDG Portal: initial color-scheme is 'no preference'"),
        Err(e) => log::warn!("XDG Portal: initial Read failed: {e}"),
    }

    while let Some(signal) = signal_stream.next().await {
        let body = signal.body();
        if let Ok((namespace, key, value)) =
            body.deserialize::<(String, String, zbus::zvariant::OwnedValue)>()
        {
            if namespace == "org.freedesktop.appearance" && key == "color-scheme" {
                // color-scheme values: 0 = no preference, 1 = prefer dark, 2 = prefer light
                let color_scheme = u32::try_from(value).unwrap_or(0);
                let theme_str = match color_scheme {
                    1 => "dark",
                    _ => "light",
                };
                log::info!(
                    "XDG Portal: system color-scheme changed to: {theme_str} (raw value: {color_scheme})"
                );
                let _ = app_handle.emit("theme-changed", theme_str);
            }
        }
    }

    Ok(())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}
