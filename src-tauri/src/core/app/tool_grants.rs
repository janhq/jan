//! Saves the configuration-level tool grants (`tauri_plugin_agent_tools::consent`)
//! in the settings store, under their own key.
//!
//! On first load it takes over the grants the web app used to keep itself
//! (`tool-approval`): "allow all MCP", trusted servers and tools trusted
//! everywhere carry over as they were, since the user set each one
//! explicitly and can now see and revoke them. Grants for one conversation
//! were never meant to outlive it and are dropped. The old key is removed once
//! the grants are saved under the new one.

use serde::Deserialize;
use tauri_plugin_agent_tools::consent::{GrantsPersistence, SavedGrants};

use super::settings_store::{settings_get, settings_remove, settings_set};

pub const TOOL_GRANTS_KEY: &str = "tool-grants";
pub const LEGACY_TOOL_APPROVAL_KEY: &str = "tool-approval";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyState {
    #[serde(default)]
    approved_servers: Vec<String>,
    #[serde(default)]
    approved_tools_global: Vec<String>,
    #[serde(default, rename = "allowAllMCPPermissions")]
    allow_all_mcp_permissions: bool,
}

#[derive(Deserialize)]
struct LegacyBlob {
    #[serde(default)]
    state: LegacyState,
}

/// The grants a `tool-approval` blob held that carry over; `None` when it is
/// unreadable, so nothing is guessed.
fn from_legacy(raw: &str) -> Option<SavedGrants> {
    let blob: LegacyBlob = serde_json::from_str(raw).ok()?;
    Some(SavedGrants {
        allow_all_mcp: blob.state.allow_all_mcp_permissions,
        servers: blob.state.approved_servers.into_iter().collect(),
        tools: blob.state.approved_tools_global.into_iter().collect(),
    })
}

pub struct SettingsGrants;

impl GrantsPersistence for SettingsGrants {
    fn load(&self) -> SavedGrants {
        if let Some(raw) = settings_get(TOOL_GRANTS_KEY.to_string()) {
            return serde_json::from_str(&raw).unwrap_or_else(|e| {
                // Unreadable means nothing is trusted: ask rather than allow.
                log::warn!("Ignoring unreadable saved tool grants: {e}");
                SavedGrants::default()
            });
        }
        let Some(legacy) = settings_get(LEGACY_TOOL_APPROVAL_KEY.to_string()) else {
            return SavedGrants::default();
        };
        let Some(grants) = from_legacy(&legacy) else {
            log::warn!("Ignoring unreadable legacy tool approvals");
            return SavedGrants::default();
        };
        self.save(&grants);
        let _ = settings_remove(LEGACY_TOOL_APPROVAL_KEY.to_string());
        grants
    }

    fn save(&self, grants: &SavedGrants) {
        match serde_json::to_string(grants) {
            Ok(raw) => {
                if let Err(e) = settings_set(TOOL_GRANTS_KEY.to_string(), raw) {
                    log::error!("Could not save tool grants: {e}");
                }
            }
            Err(e) => log::error!("Could not serialize tool grants: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_grants_carry_over_except_per_conversation_ones() {
        let raw = r#"{"state":{"approvedTools":{"t1":["mcp:fs/read"]},
            "approvedServers":["fs"],"approvedToolsGlobal":["ext:acme/notes"],
            "allowAllMCPPermissions":true},"version":0}"#;
        let grants = from_legacy(raw).unwrap();
        assert!(grants.allow_all_mcp);
        assert_eq!(grants.servers.into_iter().collect::<Vec<_>>(), ["fs"]);
        assert_eq!(grants.tools.into_iter().collect::<Vec<_>>(), ["ext:acme/notes"]);
        assert!(from_legacy("not json").is_none());
        assert_eq!(from_legacy(r#"{"version":0}"#), Some(SavedGrants::default()));
    }
}
