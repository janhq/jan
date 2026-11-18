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

/// Linux: WebKitGTK's DMA-BUF renderer cannot allocate GBM buffers on the
/// proprietary NVIDIA driver ("Failed to create GBM buffer ... Invalid argument"),
/// so the webview runs but paints nothing and Jan opens as a blank window
/// (janhq/jan#9432, janhq/jan#7015). Falling back to the shared-memory renderer
/// fixes it. A value the user already set is left alone, so
/// `WEBKIT_DISABLE_DMABUF_RENDERER=0` still opts back in.
#[cfg(target_os = "linux")]
mod webkit_nvidia {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    /// Present only while the proprietary NVIDIA kernel module is loaded; also
    /// visible inside the Flatpak sandbox.
    const NVIDIA_DRIVER: &str = "/proc/driver/nvidia/version";

    pub(crate) fn should_disable_dmabuf(user_value_set: bool, nvidia_driver: bool) -> bool {
        !user_value_set && nvidia_driver
    }

    /// Must run before any other thread starts, since it mutates the environment.
    pub(crate) fn apply() {
        let user_value_set = std::env::var_os(VAR).is_some();
        let nvidia_driver = std::path::Path::new(NVIDIA_DRIVER).exists();
        if should_disable_dmabuf(user_value_set, nvidia_driver) {
            std::env::set_var(VAR, "1");
        }
    }

    #[cfg(test)]
    mod tests {
        use super::should_disable_dmabuf;

        #[test]
        fn disables_on_nvidia_when_unset() {
            assert!(should_disable_dmabuf(false, true));
        }

        #[test]
        fn respects_a_value_the_user_set() {
            assert!(!should_disable_dmabuf(true, true));
        }

        #[test]
        fn leaves_other_drivers_alone() {
            assert!(!should_disable_dmabuf(false, false));
        }
    }
}

fn main() {
    // Must stay first: nothing below may load a DLL before the search path is restricted.
    #[cfg(windows)]
    restrict_dll_search_to_system32();

    // Before anything spawns a thread or creates the webview.
    #[cfg(target_os = "linux")]
    webkit_nvidia::apply();

    // Fix PATH before anything that may spawn subprocesses, so the engine
    // worker (and any other child) inherits directories added by fix_path_env.
    let _ = fix_path_env::fix();

    // Exits early if invoked as the Windows sandbox helper for a `bash` tool call.
    tauri_plugin_agent_tools::run_sandbox_helper_if_requested();

    app_lib::run();
}
