use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
    Manager,
};

mod commands;
mod db;
mod error;
mod state;
mod utils;

pub use error::VectorDBError;
pub use state::VectorDBState;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("vector-db")
        .invoke_handler(tauri::generate_handler![
            commands::create_collection,
            commands::insert_chunks,
            commands::create_file,
            commands::search_collection,
            commands::delete_chunks,
            commands::delete_file,
            commands::delete_collection,
            commands::chunk_text,
            commands::get_status,
            commands::list_attachments,
            commands::get_chunks,
        ])
        .setup(|app, _api| {
            app.manage(state::VectorDBState::new());
            Ok(())
        })
        .build()
}
