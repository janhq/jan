// The proxy server and its Tauri command surface are desktop-only; the `jan`
// CLI is a headless agent client with no local API server.
#[cfg(not(feature = "cli"))]
pub mod commands;
#[cfg(not(feature = "cli"))]
pub mod converters;
pub mod provider_secrets;
#[cfg(not(feature = "cli"))]
pub mod proxy;
#[cfg(not(feature = "cli"))]
pub mod remote_provider_commands;
#[cfg(test)]
#[cfg(not(feature = "cli"))]
pub mod tests;

// MLX session types used by the proxy. MLX is macOS-only, so on other platforms
// we expose a field-compatible stub: the session map is always empty there, so
// the proxy's MLX branches are dead but still compile.
#[cfg(all(target_os = "macos", not(feature = "cli")))]
pub use tauri_plugin_mlx::state::{MlxBackendSession, SessionInfo};

#[cfg(all(not(target_os = "macos"), not(feature = "cli")))]
mod mlx_stub {
    #[derive(Debug, Clone)]
    pub struct SessionInfo {
        pub pid: i32,
        pub port: i32,
        pub model_id: String,
        pub model_path: String,
        pub is_embedding: bool,
        pub api_key: String,
    }

    pub struct MlxBackendSession {
        pub info: SessionInfo,
    }
}

#[cfg(all(not(target_os = "macos"), not(feature = "cli")))]
pub use mlx_stub::{MlxBackendSession, SessionInfo};
