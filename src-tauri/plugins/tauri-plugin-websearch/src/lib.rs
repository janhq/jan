#[cfg(feature = "tauri")]
mod commands;
pub mod provider;

#[cfg(feature = "tauri")]
pub use commands::{web_fetch, web_search, WebSearchError};
pub use provider::{FetchedPage, SearchResult};

/// Initializes the web search plugin.
#[cfg(feature = "tauri")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("websearch")
        .invoke_handler(tauri::generate_handler![
            commands::web_search,
            commands::web_fetch
        ])
        .build()
}
