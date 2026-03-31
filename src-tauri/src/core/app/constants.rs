// App Configuration Constants
pub const CONFIGURATION_FILE_NAME: &str = "settings.json";

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
pub const JAN_DATA_FILES_COMMON: &[&str] = &["store.json"];

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
pub const JAN_DATA_FILES: &[&str] = &["mcp_config.json", "store.json"];
