use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod parser;
mod error;
mod commands;
mod constants;

pub use error::RagError;
pub use constants::*;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("rag")
        .invoke_handler(tauri::generate_handler![
            commands::parse_document,
        ])
        .setup(|_app, _api| Ok(()))
        .build()
}

