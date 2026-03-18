/**
 * Session Management Module
 * 
 * Manages persistent session identifier for request signing and caching.
 * Uses tauri-plugin-store for persistence (compatible with TypeScript).
 * 
 * Storage location: {app_data_dir}/updater.json
 */

use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

/// Store filename (same as TypeScript)
const STORE_NAME: &str = "updater.json";
/// Key for session in store (same as TypeScript)
const SESSION_KEY: &str = "nonce_seed";

/// Cached session ID to avoid repeated store reads
static CACHED_SESSION_ID: OnceLock<String> = OnceLock::new();

/// Get or generate session ID using tauri-plugin-store
/// Compatible with TypeScript's store access
pub fn get_session_id_with_app<R: Runtime>(app: &AppHandle<R>) -> String {
    // Return cached value if available
    if let Some(cached) = CACHED_SESSION_ID.get() {
        return cached.clone();
    }
    
    let session_id = match app.store(STORE_NAME) {
        Ok(store) => {
            // Try to get existing session ID
            if let Some(id) = store.get(SESSION_KEY) {
                if let Some(id_str) = id.as_str() {
                    log::debug!("Using existing session from store");
                    id_str.to_string()
                } else {
                    generate_and_save_session(&store)
                }
            } else {
                generate_and_save_session(&store)
            }
        }
        Err(e) => {
            log::warn!("Failed to access store: {}. Using fallback.", e);
            get_session_id_fallback()
        }
    };
    
    // Cache the ID
    let _ = CACHED_SESSION_ID.set(session_id.clone());
    
    session_id
}

/// Generate new session ID and save to store
fn generate_and_save_session(store: &tauri_plugin_store::Store<impl Runtime>) -> String {
    let new_id = Uuid::new_v4().to_string();
    log::debug!("Generated new session");
    
    // Save to store (store.set returns () in this version)
    store.set(SESSION_KEY, serde_json::json!(new_id));
    
    new_id
}

/// Get session ID without app handle
/// This is useful when app handle is not available (e.g., in download context)
pub fn get_session_id() -> String {
    if let Some(cached) = CACHED_SESSION_ID.get() {
        return cached.clone();
    }
    
    get_session_id_fallback()
}

/// Fallback session ID using process ID
fn get_session_id_fallback() -> String {
    // Use a combination of hostname and process id as fallback
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    format!("jan-{}-{}", hostname, std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_session() {
        let id = get_session_id_fallback();
        assert!(!id.is_empty());
    }
}
