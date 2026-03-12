mod commands;
mod constants;
pub mod cpu;
pub mod gpu;
mod types;
pub mod vendor;

pub use constants::*;
pub use types::*;

use std::sync::RwLock;
use tauri::Runtime;

/// Cached system info. Uses Option so we can invalidate on Linux after sleep/resume
/// (GPU detection can return empty until the driver is ready again).
static SYSTEM_INFO: RwLock<Option<SystemInfo>> = RwLock::new(None);

pub use commands::get_system_info;

/// Initialize the hardware plugin
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("hardware")
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::get_system_usage,
            commands::refresh_system_info
        ])
        .build()
}

#[cfg(test)]
mod tests;
