//! Host-owned consent snapshots for the narrow Chat execution surface.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
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

/// What the host knows about a conversation id, independent of anything the
/// webview claims. `scope=Session` is a caller-chosen IPC argument, so it is
/// never evidence of identity: elevated legacy Session calls are bound to this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadKind {
    /// A persisted Chat thread, or temporary Chat. Its consent lives in the
    /// stored grant, so legacy Session dispatch must never act for it.
    Chat,
    /// A host-recorded Cowork thread (`metadata.mode == "cowork"`).
    Cowork,
    /// No thread record, but the id is a session in the host's own legacy
    /// `code-sessions` settings blob (and not in the deletion journal). The
    /// host verified it; a renderer-chosen fresh id can never reach this.
    LegacyCowork,
    /// Invalid id, no record and not a legacy session, unreadable or malformed
    /// record or settings, no resolver installed, or an unsupported platform.
    /// Fails closed for elevated Session calls.
    Unknown,
}

impl ThreadKind {
    /// Whether an elevated (network, folder, write, memory/skill mutation,
    /// outbound) legacy `scope=Session` call may proceed for this id.
    pub fn allows_elevated_session(self) -> bool {
        matches!(self, Self::Cowork | Self::LegacyCowork)
    }
}

pub type KindFuture = Pin<Box<dyn Future<Output = ThreadKind> + Send>>;
pub type KindResolver = Arc<dyn Fn(String) -> KindFuture + Send + Sync>;
static KIND_RESOLVER: OnceLock<KindResolver> = OnceLock::new();
/// Installed by the native host, like [`set_resolver`]. First call wins.
pub fn set_kind_resolver(resolver: KindResolver) {
    let _ = KIND_RESOLVER.set(resolver);
}
/// The host's classification of `id`; [`ThreadKind::Unknown`] when the host
/// has not installed a resolver.
pub async fn thread_kind(id: &str) -> ThreadKind {
    match KIND_RESOLVER.get() {
        Some(resolve) => resolve(id.to_string()).await,
        None => ThreadKind::Unknown,
    }
}

/// A grant with nothing elevated: what an unconfirmed thread resolves to, and
/// what a narrowed entry holds.
pub fn denied() -> ThreadCapabilities {
    ThreadCapabilities {
        version: 1,
        folder_scope: None,
        shell_network: false,
        memory_write: false,
    }
}

/// Host-confirmed elevated consent for *this process*.
///
/// This mirror only ever NARROWS: a monitor poll intersects it with a freshly
/// read disk snapshot ([`authorize`]), one-shot Chat dispatch intersects it
/// with stored and caller-effective consent (`execute_thread_tool`), and
/// [`ThreadCapabilities::intersect`]
/// is a pure AND, so the result is a subset of both sides. It is therefore
/// never a source of authority -- a lost disk write, a revocation, or a
/// restart each deny on their own, whatever the other side holds. That is why
/// confirming on the strict setter's contractual success is sound without an
/// absolute durability guarantee.
///
/// It starts empty and is NEVER populated from disk, so an on-disk grant
/// cannot survive a restart unconfirmed.
struct Confirmed {
    grant: ThreadCapabilities,
    generation: u64,
}

fn confirmed() -> &'static Mutex<HashMap<String, Confirmed>> {
    static CONFIRMED: OnceLock<Mutex<HashMap<String, Confirmed>>> = OnceLock::new();
    CONFIRMED.get_or_init(Default::default)
}

/// Generation `0` is reserved for "nothing was ever confirmed", so a token
/// captured from a real narrow or confirm can never match a cleared entry.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    NEXT_GENERATION.fetch_add(1, Ordering::SeqCst)
}

/// Serializes {re-check generation, spawn, register} against {narrow, kill},
/// so a revocation can never sweep a thread's children in the window between a
/// poll deciding to spawn and `proc::spawn` registering its child. Held only
/// across the spawn itself -- never across a running shell.
pub fn admission() -> &'static tokio::sync::Mutex<()> {
    static ADMISSION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    ADMISSION.get_or_init(Default::default)
}

/// Drop every elevation for a thread and return the new generation token.
/// Callers narrow BEFORE persisting, so a failed or lost write can never
/// leave an earlier confirmation live.
pub fn narrow(thread_id: &str) -> u64 {
    let generation = next_generation();
    confirmed().lock().unwrap().insert(
        thread_id.to_string(),
        Confirmed {
            grant: denied(),
            generation,
        },
    );
    generation
}

/// Advance a thread's barrier WITHOUT touching its grant, returning the new
/// token (0 when nothing was ever confirmed, which no in-flight spawn can
/// hold past resolve). Stopping monitors needs the TOCTOU barrier -- a poll
/// that resolved earlier must not spawn after the reap -- but it is not a
/// revocation, so the confirmation the strict setter made survives.
pub fn bump_generation(thread_id: &str) -> u64 {
    let mut map = confirmed().lock().unwrap();
    match map.get_mut(thread_id) {
        Some(entry) => {
            entry.generation = next_generation();
            entry.generation
        }
        // Nothing confirmed: every poll for this thread already reads the
        // reserved generation 0 and a denied grant, so there is no live token
        // to invalidate and no entry is inserted.
        None => 0,
    }
}

/// Confirm elevations after the strict setter actually wrote them, and only
/// when no newer narrow intervened. Never called on a write error.
pub fn confirm_if_current(thread_id: &str, grant: ThreadCapabilities, token: u64) -> bool {
    if grant.validate().is_err() {
        return false;
    }
    let mut map = confirmed().lock().unwrap();
    if map.get(thread_id).map(|e| e.generation) != Some(token) {
        return false;
    }
    map.insert(
        thread_id.to_string(),
        Confirmed {
            grant,
            generation: next_generation(),
        },
    );
    true
}

/// Forget a thread at the native delete boundary, so a recreated id cannot
/// inherit a confirmation.
pub fn clear(thread_id: &str) {
    confirmed().lock().unwrap().remove(thread_id);
}

/// The current confirmation and its generation; an unknown thread is denied.
pub fn current(thread_id: &str) -> (ThreadCapabilities, u64) {
    confirmed()
        .lock()
        .unwrap()
        .get(thread_id)
        .map(|entry| (entry.grant.clone(), entry.generation))
        .unwrap_or_else(|| (denied(), 0))
}

/// Generation alone, for the re-check under [`admission`].
pub fn generation(thread_id: &str) -> u64 {
    current(thread_id).1
}

/// The per-poll authority: a freshly read disk snapshot intersected with the
/// current process confirmation. Both must independently allow, and the
/// returned generation is the barrier token for the spawn that follows.
pub async fn authorize(
    thread_id: &str,
) -> Result<(PathBuf, ThreadCapabilities, u64), String> {
    let (data_folder, stored) = snapshot(thread_id.to_string()).await?;
    let stored: ThreadCapabilities = serde_json::from_value(stored)
        .map_err(|e| format!("Invalid stored conversation capabilities: {e}"))?;
    let (mirror, generation) = current(thread_id);
    Ok((data_folder, stored.intersect(mirror)?, generation))
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

    fn elevated() -> ThreadCapabilities {
        grant(true, Some("/stored"), "write")
    }

    fn is_denied(caps: &ThreadCapabilities) -> bool {
        !caps.shell_network && !caps.memory_write && caps.folder_scope.is_none()
    }

    /// A fresh process has confirmed nothing, so every thread reads denied at
    /// the reserved generation 0.
    #[test]
    fn bootstrap_confirms_nothing() {
        let (caps, generation) = current("mirror-bootstrap");
        assert!(is_denied(&caps));
        assert_eq!(generation, 0);
        // A stale token from a previous process cannot confirm into an empty
        // mirror, which is what a restart with a stale on-disk grant looks like.
        assert!(!confirm_if_current("mirror-bootstrap", elevated(), 0));
        assert!(is_denied(&current("mirror-bootstrap").0));
    }

    /// The strict setter's own narrow token is what authorizes its confirm.
    #[test]
    fn confirm_requires_the_token_from_its_own_narrow() {
        let id = "mirror-confirm";
        let token = narrow(id);
        assert!(is_denied(&current(id).0), "narrow denies immediately");
        assert!(confirm_if_current(id, elevated(), token));
        assert!(current(id).0.shell_network);
        // Replaying the same token cannot confirm a second time.
        assert!(!confirm_if_current(id, elevated(), token));
    }

    /// Revoke landing between persist and confirm: the later narrow wins and
    /// the in-flight confirm is dropped rather than resurrecting the grant.
    #[test]
    fn only_host_verified_cowork_kinds_allow_elevated_session() {
        assert!(ThreadKind::Cowork.allows_elevated_session());
        assert!(ThreadKind::LegacyCowork.allows_elevated_session());
        assert!(!ThreadKind::Chat.allows_elevated_session());
        assert!(!ThreadKind::Unknown.allows_elevated_session());
    }

    #[tokio::test]
    async fn no_installed_kind_resolver_is_unknown() {
        // This test binary never installs a resolver.
        assert_eq!(thread_kind("anything").await, ThreadKind::Unknown);
    }

    #[test]
    fn a_newer_narrow_blocks_an_in_flight_confirm() {
        let id = "mirror-race";
        let first = narrow(id);
        let second = narrow(id);
        assert_ne!(first, second);
        assert!(!confirm_if_current(id, elevated(), first));
        assert!(is_denied(&current(id).0));
        // The newer caller still confirms with its own token.
        assert!(confirm_if_current(id, elevated(), second));
    }

    /// A failed write simply never confirms, and never restores what narrow
    /// dropped.
    #[test]
    fn a_failed_write_leaves_the_mirror_denied() {
        let id = "mirror-write-error";
        assert!(confirm_if_current(id, elevated(), narrow(id)));
        let token = narrow(id); // the next setter narrows first...
        let _ = token; // ...then its persist fails, so confirm is never called.
        assert!(is_denied(&current(id).0));
    }

    /// Stopping a thread's monitors advances the barrier but is not a
    /// revocation: the confirmed grant survives, while a poll holding the old
    /// token refuses to spawn.
    #[test]
    fn bumping_the_barrier_keeps_the_grant() {
        let id = "mirror-bump";
        assert_eq!(bump_generation(id), 0, "nothing confirmed, nothing to bump");
        let token = narrow(id);
        assert!(confirm_if_current(id, elevated(), token));
        let (_, confirmed_at) = current(id);
        let bumped = bump_generation(id);
        assert_ne!(bumped, 0);
        assert_ne!(bumped, confirmed_at, "the barrier advanced");
        let (caps, generation) = current(id);
        assert_eq!(generation, bumped, "polls read the bumped token");
        assert!(caps.shell_network, "the grant survives a stop, unlike a revoke");
    }

    /// Deleting a thread forgets it, so an id supplied again at creation
    /// cannot inherit the old confirmation.
    #[test]
    fn clear_prevents_identity_reuse() {
        let id = "mirror-reuse";
        let token = narrow(id);
        assert!(confirm_if_current(id, elevated(), token));
        clear(id);
        let (caps, generation) = current(id);
        assert!(is_denied(&caps));
        assert_eq!(generation, 0, "a cleared entry reads as never-confirmed");
        assert!(!confirm_if_current(id, elevated(), token));
        assert!(is_denied(&current(id).0));
    }

    /// Generations are process-monotonic, so a barrier token captured at
    /// resolve can never be matched by a later unrelated change.
    #[test]
    fn generations_never_repeat() {
        let mut seen = std::collections::HashSet::new();
        for index in 0..32 {
            let id = format!("mirror-generation-{index}");
            let token = narrow(&id);
            assert!(seen.insert(token), "a generation was reused");
            assert_eq!(generation(&id), token, "the token is what a poll reads");
            let confirmed = narrow(&id);
            assert!(seen.insert(confirmed), "a generation was reused");
            assert_ne!(confirmed, token, "every narrow advances the barrier");
        }
    }

    /// The safety property the whole design rests on: the mirror can only
    /// narrow. Either side denying is enough, so a lost disk write and a
    /// revocation each deny on their own.
    #[test]
    fn either_side_denying_is_enough() {
        let stored_lost = denied().intersect(elevated()).unwrap();
        assert!(is_denied(&stored_lost), "lost disk write denies");
        let mirror_revoked = elevated().intersect(denied()).unwrap();
        assert!(is_denied(&mirror_revoked), "revoked mirror denies");
        let both = elevated().intersect(elevated()).unwrap();
        assert!(both.shell_network, "agreement still grants");
    }
}
