use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
pub mod provider;

pub use commands::{web_fetch, web_search, WebSearchError};
pub use provider::{FetchedPage, SearchResult};

/// Initializes the web search plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("websearch")
        .invoke_handler(tauri::generate_handler![
            commands::web_search,
            commands::web_fetch
        ])
        .build()
}
