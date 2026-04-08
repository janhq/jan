// App Configuration Constants
pub const CONFIGURATION_FILE_NAME: &str = "settings.json";

/// Tauri bundle `identifier` from `tauri.conf.json`. Used only as a fallback
/// source for legacy config recovery.
pub const TAURI_BUNDLE_IDENTIFIER: &str = "jan.ai.app";

// Categorised lists of Jan data directories and files.
// The factory-reset logic selectively deletes by category based on user choices.
// Add new entries to the appropriate category so they are picked up automatically.

/// Conversations & user data — chat threads and assistant profiles.
/// Gated by the `keep_app_data` flag during factory reset.
pub const JAN_DATA_DIRS_CONVERSATIONS: &[&str] = &["threads", "assistants"];

/// Downloaded models and engine binaries.
/// Gated by the `keep_models_and_configs` flag during factory reset.
pub const JAN_DATA_DIRS_MODELS: &[&str] = &["models", "llamacpp", "mlx", "openclaw"];

/// Configuration files — engine settings, MCP config, etc.
/// Gated by the `keep_models_and_configs` flag during factory reset.
pub const JAN_DATA_FILES_CONFIGS: &[&str] = &["mcp_config.json"];

/// Extensions, logs, and caches — always cleaned during any reset.
pub const JAN_DATA_DIRS_COMMON: &[&str] = &["extensions", "logs", ".npx", ".uvx"];

/// Cross-category settings file (contains data spanning conversations, models,
/// and UI preferences). Only deleted during a full wipe — i.e. when the user
/// keeps neither conversations nor models/configs.
/// After #7821, zustand stores persist to `settings.json` via @tauri-apps/plugin-store.
pub const JAN_DATA_FILES_SETTINGS: &[&str] = &["settings.json"];

/// All known data subdirectories (union of every category above).
pub const JAN_DATA_SUBDIRS: &[&str] = &[
    "threads",
    "assistants",
    "extensions",
    "logs",
    "models",
    "llamacpp",
    "mlx",
    "openclaw",
    ".npx",
    ".uvx",
];

/// All known data files (union of every file category above).
pub const JAN_DATA_FILES: &[&str] = &["mcp_config.json", "settings.json"];

// NOTE: when adding new entries, place them in the appropriate category above
// so the factory-reset logic handles them automatically. Then add them to the
// comprehensive JAN_DATA_SUBDIRS / JAN_DATA_FILES lists as well.
