use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("utils")
    .invoke_handler(tauri::generate_handler![])
    .build()
}
