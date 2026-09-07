#[cfg(feature = "tauri")]
mod commands;
pub mod db;
mod error;
mod state;
mod utils;

pub use error::VectorDBError;
pub use state::VectorDBState;

#[cfg(feature = "tauri")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::Manager;

    tauri::plugin::Builder::new("vector-db")
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
            commands::memory_index,
            commands::memory_search,
            commands::memory_clear,
        ])
        .setup(|app, _api| {
            app.manage(state::VectorDBState::new());
            Ok(())
        })
        .build()
}
