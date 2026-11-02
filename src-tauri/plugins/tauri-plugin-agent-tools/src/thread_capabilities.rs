//! Host-owned consent snapshots for the narrow Chat execution surface.
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, OnceLock},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadCapabilities {
    pub version: u8,
    pub folder_scope: Option<FolderScope>,
    pub shell_network: bool,
    pub memory_write: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderScope {
    pub path: String,
    pub access: String,
}
pub type SnapshotFuture =
    Pin<Box<dyn Future<Output = Result<(PathBuf, serde_json::Value), String>> + Send>>;
pub type SnapshotResolver = Arc<dyn Fn(String) -> SnapshotFuture + Send + Sync>;
static RESOLVER: OnceLock<SnapshotResolver> = OnceLock::new();
/// Installed by the native host; no caller-controlled data root fallback.
pub fn set_resolver(resolver: SnapshotResolver) {
    let _ = RESOLVER.set(resolver);
}
pub async fn snapshot(id: String) -> Result<(PathBuf, serde_json::Value), String> {
    RESOLVER
        .get()
        .ok_or("Thread consent resolver is unavailable")?(id)
    .await
}
impl ThreadCapabilities {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.folder_scope.as_ref().is_some_and(|f| {
                !matches!(f.access.as_str(), "read" | "write")
                    || !std::path::Path::new(&f.path).is_absolute()
            })
        {
            return Err("Invalid conversation capabilities".into());
        }
        Ok(())
    }
    /// An overlay may revoke/narrow consent, but never supply authority.
    pub fn intersect(mut self, overlay: Self) -> Result<Self, String> {
        self.validate()?;
        overlay.validate()?;
        self.shell_network &= overlay.shell_network;
        self.memory_write &= overlay.memory_write;
        self.folder_scope = match (self.folder_scope, overlay.folder_scope) {
            (Some(stored), Some(effective)) if stored.path == effective.path => Some(FolderScope {
                path: stored.path,
                access: if stored.access == "write" && effective.access == "write" {
                    "write"
                } else {
                    "read"
                }
                .into(),
            }),
            _ => None,
        };
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn grant(enabled: bool, path: Option<&str>, access: &str) -> ThreadCapabilities {
        ThreadCapabilities {
            version: 1,
            folder_scope: path.map(|p| FolderScope {
                path: p.into(),
                access: access.into(),
            }),
            shell_network: enabled,
            memory_write: enabled,
        }
    }
    #[test]
    fn intersection_never_widens_disk_or_local_revocation() {
        for (stored, effective) in [(false, true), (true, false)] {
            let result = grant(stored, None, "read")
                .intersect(grant(effective, Some("/forged"), "write"))
                .unwrap();
            assert!(!result.shell_network);
            assert!(!result.memory_write);
            assert!(result.folder_scope.is_none());
        }
        let result = grant(true, Some("/stored"), "read")
            .intersect(grant(true, Some("/stored"), "write"))
            .unwrap();
        assert_eq!(result.folder_scope.unwrap().access, "read");
        let result = grant(true, Some("/stored"), "write")
            .intersect(grant(true, Some("/different"), "write"))
            .unwrap();
        assert!(result.folder_scope.is_none());
    }
    #[tokio::test]
    async fn missing_host_resolver_fails_closed() {
        assert!(snapshot("chat".into()).await.is_err());
    }
}
