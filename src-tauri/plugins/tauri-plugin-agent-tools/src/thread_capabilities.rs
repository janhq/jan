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

/// App-wide Chat permissions for shell network access and durable memory
/// writes. They are settings, not per-conversation consent: the host owns the
/// value (loaded from its data folder, changed only through its own command) and
/// applies it to host authority, never to a caller's frozen effective ceiling.
/// Both default to on, matching the old Cowork behaviour. The folder scope stays
/// a per-conversation grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalGrants {
    pub shell_network: bool,
    pub memory_write: bool,
}

impl Default for GlobalGrants {
    fn default() -> Self {
        Self {
            shell_network: true,
            memory_write: true,
        }
    }
}

fn global_grants() -> &'static Mutex<GlobalGrants> {
    static GLOBAL: OnceLock<Mutex<GlobalGrants>> = OnceLock::new();
    GLOBAL.get_or_init(|| Mutex::new(GlobalGrants::default()))
}

/// Installed by the host at startup and whenever the setting changes.
pub fn set_global_grants(next: GlobalGrants) {
    *global_grants().lock().unwrap_or_else(|e| e.into_inner()) = next;
}

pub fn get_global_grants() -> GlobalGrants {
    *global_grants().lock().unwrap_or_else(|e| e.into_inner())
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

/// Process entries distinguish never-loaded from explicitly denied. A durable
/// marker blocks restart restoration after a failed metadata write. Marker I/O
/// and mirror transitions share the mirror mutex, so no stale loader or
/// confirmation can erase a newer revoke.
static CONSENT_ROOT: OnceLock<Arc<dyn Fn() -> PathBuf + Send + Sync>> = OnceLock::new();
pub fn set_consent_root_resolver(resolve: Arc<dyn Fn() -> PathBuf + Send + Sync>) {
    let _ = CONSENT_ROOT.set(resolve);
}
fn marker(thread_id: &str) -> Result<Option<PathBuf>, String> {
    let segment = crate::workspace::thread_segment(thread_id)?;
    Ok(CONSENT_ROOT.get().map(|root| root().join("conversation-denials").join(segment)))
}
fn write_denial(thread_id: &str) -> Result<(), String> {
    if let Some(path) = marker(thread_id)? {
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        // Contents are deliberately irrelevant: even a corrupt/empty marker denies.
        let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        sync_directory(parent)?;
        sync_directory(parent.parent().unwrap())?;
    }
    Ok(())
}
fn sync_directory(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    std::fs::File::open(path).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn remove_denial(thread_id: &str) -> Result<(), String> {
    if let Some(path) = marker(thread_id)? {
        match std::fs::remove_file(&path) {
            Ok(()) => {
                if let Err(error) = sync_directory(path.parent().unwrap()) {
                    let _ = write_denial(thread_id);
                    return Err(error);
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
/// Called only with a host-validated disk snapshot. Never overwrite an entry,
/// including explicit denial, even if disk still contains an older grant.
pub fn restore_if_absent(thread_id: &str, grant: ThreadCapabilities) -> Result<(), String> {
    grant.validate()?;
    let mut map = confirmed().lock().unwrap();
    if map.contains_key(thread_id) { return Ok(()); }
    // Platforms without a directory durability primitive cannot safely replay
    // saved authority: an acknowledged marker could disappear after a crash.
    // Explicit grants still work in-process; never auto-restore them there.
    let blocked = !cfg!(unix) || match marker(thread_id)? {
        Some(path) => match std::fs::symlink_metadata(path) {
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => true,
        },
        None => false,
    };
    map.insert(thread_id.to_string(), Confirmed {
        grant: if blocked { denied() } else { grant },
        generation: next_generation(),
        durability_error: None,
    });
    Ok(())
}
pub fn denial_persisted(thread_id: &str) -> Result<(), String> {
    let map = confirmed().lock().unwrap();
    match map.get(thread_id).and_then(|e| e.durability_error.clone()) {
        Some(error) => Err(format!("Access denied in this process, but restart-safe revocation failed: {error}")),
        None => Ok(()),
    }
}

struct Confirmed {
    grant: ThreadCapabilities,
    generation: u64,
    durability_error: Option<String>,
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
    let mut map = confirmed().lock().unwrap();
    let durability_error = write_denial(thread_id).err();
    map.insert(thread_id.to_string(), Confirmed { grant: denied(), generation, durability_error });
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
    if remove_denial(thread_id).is_err() { return false; }
    map.insert(thread_id.to_string(), Confirmed {
        grant, generation: next_generation(), durability_error: None,
    });
    true
}

/// Finalize a deleted identity in memory, preserving the durable denial (and
/// any durability error) already installed by the pre-removal revoke. No I/O
/// is allowed here: the record is gone, so failure could create a UI ghost.
/// Advance the barrier even for an already denied entry, invalidating stale
/// confirmations and monitor polls racing with finalization.
pub fn clear(thread_id: &str) -> u64 {
    let mut map = confirmed().lock().unwrap();
    let entry = map.entry(thread_id.to_string()).or_insert_with(|| Confirmed {
        grant: denied(), generation: 0, durability_error: None,
    });
    entry.grant = denied();
    entry.generation = next_generation();
    entry.generation
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
/// current process confirmation for folders. Network/memory instead use the
/// host's current app-wide settings for persistent Chat, and stay denied for
/// temporary Chat. Callers must additionally intersect any
/// frozen run/start-time ceiling, without applying `with_global` to that ceiling.
/// The returned generation is the barrier token for the spawn that follows.
pub async fn authorize(
    thread_id: &str,
) -> Result<(PathBuf, ThreadCapabilities, u64), String> {
    let (data_folder, stored) = snapshot(thread_id.to_string()).await?;
    let stored: ThreadCapabilities = serde_json::from_value(stored)
        .map_err(|e| format!("Invalid stored conversation capabilities: {e}"))?;
    let (mirror, generation) = current(thread_id);
    Ok((
        data_folder,
        stored.with_global(thread_id).intersect(mirror.with_global(thread_id))?,
        generation,
    ))
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
    /// Replace the two app-wide fields with the host's current setting for
    /// persistent Chat only. Temporary Chat has no elevated host authority,
    /// irrespective of caller-effective permissions. Folder scope is untouched.
    pub fn with_global(mut self, thread_id: &str) -> Self {
        let global = get_global_grants();
        self.shell_network = thread_id != "temporary-chat" && global.shell_network;
        self.memory_write = thread_id != "temporary-chat" && global.memory_write;
        self
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

    /// Revoke landing between persist and confirm: the later narrow wins and
    /// the in-flight confirm is dropped rather than resurrecting the grant.
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
        assert_ne!(generation, 0, "a deleted identity retains an explicit denial barrier");
        assert!(!confirm_if_current(id, elevated(), token));
        assert!(is_denied(&current(id).0));
    }

    #[cfg(not(unix))]
    #[test]
    fn saved_grants_require_explicit_confirmation_without_directory_durability() {
        let id = "unsupported-directory-durability";
        restore_if_absent(id, elevated()).unwrap();
        assert!(is_denied(&current(id).0), "saved authority cannot auto-restore");
        let token = narrow(id);
        assert!(confirm_if_current(id, elevated(), token), "explicit current-process consent still works");
        assert!(!is_denied(&current(id).0));
    }

    #[cfg(unix)]
    #[test]
    fn durable_denials_block_restart_stale_fetch_corruption_and_reused_ids() {
        struct TestDirectory(PathBuf);
        impl Drop for TestDirectory {
            fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
        }
        let path = std::env::temp_dir().join(format!("jan-consent-test-{}-{}",
            std::process::id(), std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&path).unwrap();
        let _directory = TestDirectory(path.clone());
        let configured = path.clone();
        set_consent_root_resolver(Arc::new(move || configured.clone()));
        let id = "durable-restart";
        restore_if_absent(id, elevated()).unwrap();
        assert!(!is_denied(&current(id).0));
        // A failed save leaves the narrow and marker, not a stale grant.
        narrow(id);
        denial_persisted(id).unwrap();
        restore_if_absent(id, elevated()).unwrap();
        assert!(is_denied(&current(id).0));
        confirmed().lock().unwrap().remove(id); // simulated process restart
        restore_if_absent(id, elevated()).unwrap();
        assert!(is_denied(&current(id).0));
        // Corrupt/empty markers are denial too, never interpreted as consent.
        std::fs::write(marker(id).unwrap().unwrap(), b"{broken").unwrap();
        confirmed().lock().unwrap().remove(id);
        restore_if_absent(id, elevated()).unwrap();
        assert!(is_denied(&current(id).0));
        // Only a strict successful write/confirmation removes the marker.
        let token = narrow(id);
        assert!(confirm_if_current(id, elevated(), token));
        assert!(!marker(id).unwrap().unwrap().exists());
        confirmed().lock().unwrap().remove(id);
        restore_if_absent(id, elevated()).unwrap();
        assert!(!is_denied(&current(id).0));
        // The host must acknowledge durable denial BEFORE removing the record.
        let revoked_at = narrow(id);
        denial_persisted(id).unwrap();
        let marker_path = marker(id).unwrap().unwrap();
        std::fs::remove_file(&marker_path).unwrap();
        std::fs::create_dir(&marker_path).unwrap(); // redundant marker write would fail
        let finalized_at = clear(id);
        assert_ne!(finalized_at, revoked_at);
        denial_persisted(id).expect("finalize preserves the acknowledged denial");
        assert!(!confirm_if_current(id, elevated(), revoked_at));
        confirmed().lock().unwrap().remove(id);
        restore_if_absent(id, elevated()).unwrap();
        assert!(is_denied(&current(id).0), "deleted/reused id cannot inherit disk consent");
        // Failed marker writes still deny in-process and surface durability failure.
        let bad = "durable-marker-failure";
        std::fs::create_dir(marker(bad).unwrap().unwrap()).unwrap();
        narrow(bad);
        assert!(denial_persisted(bad).is_err());
        restore_if_absent(bad, elevated()).unwrap();
        assert!(is_denied(&current(bad).0));
        clear(bad);
        assert!(denial_persisted(bad).is_err(), "delete cannot hide failed durable denial");
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

    // The setting is process-wide, so every assertion about it lives in ONE
    // test: parallel tests would race on the shared value.
    #[test]
    fn global_overlay_decides_network_and_memory_but_never_the_folder() {
        let stored_off = grant(false, Some("/stored"), "read");

        set_global_grants(GlobalGrants {
            shell_network: true,
            memory_write: true,
        });
        let on = stored_off.clone().with_global("persistent-chat");
        assert!(
            on.shell_network && on.memory_write,
            "defaults give Chat network and memory"
        );
        assert_eq!(on.folder_scope.as_ref().unwrap().path, "/stored");

        set_global_grants(GlobalGrants {
            shell_network: false,
            memory_write: true,
        });
        let split = grant(true, None, "read").with_global("persistent-chat");
        assert!(!split.shell_network, "a global off beats a stored grant");
        assert!(split.memory_write, "fields are independent");

        // Global settings apply to host layers, never to a frozen effective
        // ceiling. A forged effective true cannot beat global false.
        let forged = grant(true, Some("/stored"), "write");
        let result = grant(false, Some("/stored"), "write")
            .with_global("persistent-chat")
            .intersect(forged.with_global("persistent-chat"))
            .unwrap();
        assert!(!result.shell_network && result.memory_write);
        assert_eq!(result.folder_scope.unwrap().access, "write");

        // The folder still needs the layers to agree.
        let result = grant(true, Some("/stored"), "write")
            .with_global("persistent-chat")
            .intersect(grant(true, None, "read").with_global("persistent-chat"))
            .unwrap();
        assert!(result.folder_scope.is_none());

        set_global_grants(GlobalGrants::default());
        for ceiling in [denied(), grant(false, Some("/stored"), "write")] {
            let result = grant(true, Some("/stored"), "write")
                .with_global("persistent-chat")
                .intersect(ceiling)
                .unwrap()
                .intersect(denied().with_global("persistent-chat"))
                .unwrap();
            assert!(!result.shell_network && !result.memory_write,
                "frozen false ceilings cannot be widened by global ON");
        }
        // Fully forged effective grants cannot supply temporary Chat authority,
        // even with global ON or stale elevated host layers.
        for stored in [denied(), elevated()] {
            for mirror in [denied(), elevated()] {
                let temporary = stored
                    .clone()
                    .with_global("temporary-chat")
                    .intersect(elevated())
                    .unwrap()
                    .intersect(mirror.with_global("temporary-chat"))
                    .unwrap();
                assert!(!temporary.shell_network && !temporary.memory_write);
            }
        }
        // Ordinary unconfirmed Chat can use app-wide grants; its folder stays
        // denied. Confirmation/revocation is not network/memory authority.
        let ordinary = denied()
            .with_global("persistent-chat")
            .intersect(grant(true, Some("/stored"), "write"))
            .unwrap()
            .intersect(denied().with_global("persistent-chat"))
            .unwrap();
        assert!(ordinary.shell_network && ordinary.memory_write);
        assert!(ordinary.folder_scope.is_none());

        set_global_grants(GlobalGrants::default());
        assert_eq!(
            get_global_grants(),
            GlobalGrants {
                shell_network: true,
                memory_write: true
            }
        );
    }
}
