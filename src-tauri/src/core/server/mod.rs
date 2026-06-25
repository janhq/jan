pub mod commands;
pub mod proxy;
pub mod remote_provider_commands;
#[cfg(test)]
pub mod tests;

// MLX session types used by the proxy. MLX is macOS-only, so on other platforms
// we expose a field-compatible stub: the session map is always empty there, so
// the proxy's MLX branches are dead but still compile.
#[cfg(target_os = "macos")]
pub use tauri_plugin_mlx::state::{MlxBackendSession, SessionInfo};

#[cfg(not(target_os = "macos"))]
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

#[cfg(not(target_os = "macos"))]
pub use mlx_stub::{MlxBackendSession, SessionInfo};
