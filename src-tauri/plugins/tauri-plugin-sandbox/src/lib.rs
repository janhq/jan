pub mod executor;
pub mod microvm;
pub mod wasm_runtime;

use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sandbox").build()
}
