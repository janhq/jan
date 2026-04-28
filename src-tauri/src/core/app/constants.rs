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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn configuration_file_name_matches_settings_entry() {
        assert_eq!(CONFIGURATION_FILE_NAME, "settings.json");
        assert!(JAN_DATA_FILES_SETTINGS.contains(&CONFIGURATION_FILE_NAME));
    }

    #[test]
    fn tauri_bundle_identifier_is_stable() {
        assert_eq!(TAURI_BUNDLE_IDENTIFIER, "jan.ai.app");
    }

    #[test]
    fn jan_data_subdirs_is_union_of_all_dir_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in JAN_DATA_DIRS_CONVERSATIONS
            .iter()
            .chain(JAN_DATA_DIRS_MODELS.iter())
            .chain(JAN_DATA_DIRS_COMMON.iter())
        {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = JAN_DATA_SUBDIRS.iter().copied().collect();
        assert_eq!(union, listed, "JAN_DATA_SUBDIRS must equal union of categories");
    }

    #[test]
    fn jan_data_files_is_union_of_all_file_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in JAN_DATA_FILES_CONFIGS.iter().chain(JAN_DATA_FILES_SETTINGS.iter()) {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = JAN_DATA_FILES.iter().copied().collect();
        assert_eq!(union, listed);
    }

    #[test]
    fn dir_categories_have_no_overlap() {
        let conv: HashSet<&str> = JAN_DATA_DIRS_CONVERSATIONS.iter().copied().collect();
        let models: HashSet<&str> = JAN_DATA_DIRS_MODELS.iter().copied().collect();
        let common: HashSet<&str> = JAN_DATA_DIRS_COMMON.iter().copied().collect();
        assert!(conv.is_disjoint(&models));
        assert!(conv.is_disjoint(&common));
        assert!(models.is_disjoint(&common));
    }

    #[test]
    fn known_entries_present() {
        assert!(JAN_DATA_DIRS_CONVERSATIONS.contains(&"threads"));
        assert!(JAN_DATA_DIRS_MODELS.contains(&"models"));
        assert!(JAN_DATA_DIRS_COMMON.contains(&"logs"));
        assert!(JAN_DATA_FILES_CONFIGS.contains(&"mcp_config.json"));
    }
}

// NOTE: when adding new entries, place them in the appropriate category above
// so the factory-reset logic handles them automatically. Then add them to the
// comprehensive JAN_DATA_SUBDIRS / JAN_DATA_FILES lists as well.
