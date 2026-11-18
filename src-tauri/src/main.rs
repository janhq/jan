// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Windows: from here on, every DLL the process loads is resolved from System32 only,
/// including the dependencies that System32 DLLs load lazily (e.g. `windows.storage.dll`
/// pulling in `profapi.dll` the first time a shell folder is queried). Without it those
/// loads search the install folder first, so a DLL planted there runs inside Jan.
/// The `/DEPENDENTLOADFLAG` link arg in build.rs only covers the exe's own static
/// imports, which are resolved before `main`. The setting is per process and is not
/// inherited by the engine worker or other helpers Jan spawns.
#[cfg(windows)]
fn restrict_dll_search_to_system32() {
    use windows_sys::Win32::System::LibraryLoader::{
        SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    // SAFETY: plain Win32 call with a constant flag and no pointers. It only fails on
    // Windows builds that predate the API, where there is nothing to restrict.
    let _ = unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) };
}

/// Whether to turn off WebKitGTK's DMA-BUF renderer for this launch.
///
/// Inside the Flatpak (GNOME 51 runtime, WebKitGTK 2.54) on an X11 session,
/// the DMA-BUF renderer presents a stale frame when a CSS animation ends: a
/// popover that just faded out is drawn fully opaque for one frame, and one
/// that just faded in is drawn blank for one frame, so menus visibly flicker.
/// The fallback renderer has no such glitch. Wayland sessions and non-Flatpak
/// builds (which use the distro's WebKitGTK) are left alone, and an explicit
/// `WEBKIT_DISABLE_DMABUF_RENDERER` set by the user always wins.
#[cfg(target_os = "linux")]
fn should_disable_webkit_dmabuf(
    in_flatpak: bool,
    wayland_display: Option<&str>,
    gdk_backend: Option<&str>,
    user_override: bool,
) -> bool {
    if !in_flatpak || user_override {
        return false;
    }
    let forced_x11 = gdk_backend.is_some_and(|b| b.trim_start().starts_with("x11"));
    let has_wayland = wayland_display.is_some_and(|d| !d.is_empty());
    forced_x11 || !has_wayland
}

/// Applies [`should_disable_webkit_dmabuf`]. Must run before any thread is
/// spawned (it mutates the environment) and before WebKit initializes.
#[cfg(target_os = "linux")]
fn apply_webkit_dmabuf_workaround() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    let in_flatpak =
        std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists();
    let wayland_display = std::env::var("WAYLAND_DISPLAY").ok();
    let gdk_backend = std::env::var("GDK_BACKEND").ok();
    if should_disable_webkit_dmabuf(
        in_flatpak,
        wayland_display.as_deref(),
        gdk_backend.as_deref(),
        std::env::var_os(VAR).is_some(),
    ) {
        std::env::set_var(VAR, "1");
    }
}

fn main() {
    // Must stay first: nothing below may load a DLL before the search path is restricted.
    #[cfg(windows)]
    restrict_dll_search_to_system32();

    // Before anything spawns a thread or touches WebKit (see the fn docs).
    #[cfg(target_os = "linux")]
    apply_webkit_dmabuf_workaround();

    // Fix PATH before anything that may spawn subprocesses, so the engine
    // worker (and any other child) inherits directories added by fix_path_env.
    let _ = fix_path_env::fix();

    // Exits early if invoked as the Windows sandbox helper for a `bash` tool call.
    tauri_plugin_agent_tools::run_sandbox_helper_if_requested();

    app_lib::run();
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::should_disable_webkit_dmabuf as decide;

    #[test]
    fn flatpak_on_x11_disables_dmabuf() {
        assert!(decide(true, None, None, false));
        assert!(decide(true, Some(""), None, false));
        // Wayland socket present but GTK forced onto X11.
        assert!(decide(true, Some("wayland-0"), Some("x11"), false));
        assert!(decide(true, Some("wayland-0"), Some("x11,wayland"), false));
    }

    #[test]
    fn leaves_other_setups_alone() {
        // Not a Flatpak: the distro's WebKitGTK is not affected.
        assert!(!decide(false, None, None, false));
        // Flatpak on Wayland.
        assert!(!decide(true, Some("wayland-0"), None, false));
        assert!(!decide(true, Some("wayland-0"), Some("wayland"), false));
        // The user's own setting always wins.
        assert!(!decide(true, None, None, true));
    }
}
