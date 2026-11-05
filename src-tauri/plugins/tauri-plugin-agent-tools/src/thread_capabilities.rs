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
    #[cfg(test)]
    if let Some(kind) = test_identities().lock().unwrap().get(id).copied() {
        return kind;
    }
    match KIND_RESOLVER.get() {
        Some(resolve) => resolve(id.to_string()).await,
        None => ThreadKind::Unknown,
    }
}

/// Test-only per-id host kind, consulted before the installed resolver so
/// tests that rely on "no resolver installed" keep their meaning for other ids.
#[cfg(test)]
fn test_identities() -> &'static Mutex<HashMap<String, ThreadKind>> {
    static IDS: OnceLock<Mutex<HashMap<String, ThreadKind>>> = OnceLock::new();
    IDS.get_or_init(Default::default)
}
#[cfg(test)]
pub(crate) fn test_set_kind(id: &str, kind: ThreadKind) {
    test_identities().lock().unwrap().insert(id.to_string(), kind);
}

/// Legacy (no host grant record) binding. A folder is NEVER authorized here:
/// `metadata.folder` and the `code-sessions` blob are renderer-writable, so they
/// cannot stand in for a host grant. The caller must confirm the folder through
/// the strict setter first. The host must still positively identify the id as
/// Cowork; scratch-only calls (no folder) keep working and never get write.
pub async fn bind_legacy_session(
    id: &str,
    folder: Option<&str>,
    writable: Option<bool>,
) -> Result<(Option<String>, Option<bool>), String> {
    if !thread_kind(id).await.allows_elevated_session() {
        return Err("Folder access requires a host-verified Cowork session".into());
    }
    if folder.is_some() {
        return Err(
            "This conversation's folder has not been confirmed. Confirm or re-select the folder to grant access"
                .into(),
        );
    }
    Ok((None, writable.map(|_| false)))
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
/// is serialized per identity, never under the mirror mutex.
/// Revocations publish denial before waiting for I/O; confirmations recheck
/// their generation after I/O and repair a marker if a revocation raced.
static CONSENT_ROOT: OnceLock<Arc<dyn Fn() -> PathBuf + Send + Sync>> = OnceLock::new();
pub fn set_consent_root_resolver(resolve: Arc<dyn Fn() -> PathBuf + Send + Sync>) {
    let _ = CONSENT_ROOT.set(resolve);
}
/// Only marker operations take this lock; never acquire it while holding the
/// mirror or spawn-admission lock. Entries live as long as mirror identities.
fn marker_lock(thread_id: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(thread_id.to_string())
        .or_default()
        .clone()
}
fn marker(thread_id: &str) -> Result<Option<PathBuf>, String> {
    let segment = crate::workspace::thread_segment(thread_id)?;
    // Thread ids cannot contain '.', so the ledger name never collides with a
    // marker and a path always identifies its own on-disk format.
    let name = if cfg!(unix) {
        segment
    } else {
        format!("{segment}{LEDGER_SUFFIX}")
    };
    Ok(CONSENT_ROOT
        .get()
        .map(|root| root().join("conversation-denials").join(name)))
}
/// The durable denial store entry for one identity on this platform: a marker
/// file on Unix, the per-identity ledger elsewhere. Host fault-injection tests
/// target this so they exercise the real backend instead of a hardcoded name.
pub fn denial_store_path(thread_id: &str) -> Result<Option<PathBuf>, String> {
    marker(thread_id)
}
#[cfg(test)]
type IoHook = Arc<dyn Fn(&str) + Send + Sync>;
#[cfg(test)]
fn io_hooks() -> &'static Mutex<HashMap<String, IoHook>> {
    static HOOKS: OnceLock<Mutex<HashMap<String, IoHook>>> = OnceLock::new();
    HOOKS.get_or_init(Default::default)
}
#[cfg(test)]
fn before_io(thread_id: &str, operation: &str) {
    let hook = io_hooks().lock().unwrap().get(thread_id).cloned();
    if let Some(hook) = hook {
        hook(operation);
    }
}
fn write_denial_at(thread_id: &str, path: Option<PathBuf>) -> Result<(), String> {
    #[cfg(test)]
    before_io(thread_id, "write");
    #[cfg(not(test))]
    let _ = thread_id;
    if let Some(path) = path {
        if is_ledger(&path) {
            return ledger_append(&path, thread_id, LedgerOp::Deny, None);
        }
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
    std::fs::File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn remove_denial_at(thread_id: &str, marker_path: Option<PathBuf>) -> Result<(), Fault> {
    if let Some(path) = marker_path {
        match std::fs::remove_file(&path) {
            Ok(()) => {
                if let Err(error) = sync_directory(path.parent().unwrap()) {
                    // The unlink may or may not persist; only a recreated marker
                    // proves the denial survives. Report whether it does.
                    return Err(match write_denial_at(thread_id, Some(path.clone())) {
                        Ok(()) => Fault::ConfirmFailed(error),
                        Err(rollback) => Fault::ConfirmRollbackFailed { confirm: error, rollback },
                    });
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(Fault::ConfirmFailed(e.to_string())),
        }
    }
    Ok(())
}
/// Called only with a host-validated disk snapshot. Never overwrite an entry,
/// including explicit denial, even if disk still contains an older grant.
pub fn restore_if_absent(thread_id: &str, grant: ThreadCapabilities) -> Result<(), String> {
    restore_at(thread_id, grant, marker(thread_id)?)
}
fn restore_at(
    thread_id: &str,
    grant: ThreadCapabilities,
    marker_path: Option<PathBuf>,
) -> Result<(), String> {
    grant.validate()?;
    if confirmed().lock().unwrap().contains_key(thread_id) {
        return Ok(());
    }
    let lock = marker_lock(thread_id);
    let _io = lock.lock().unwrap();
    #[cfg(test)]
    before_io(thread_id, "restore");
    // Unix: any marker (even corrupt, or a directory) denies. Elsewhere there is
    // no directory-sync primitive, so denial cannot rest on a marker's existence;
    // the per-identity ledger needs a durable, positive CONFIRM to restore.
    let restored = match marker_path {
        Some(path) if is_ledger(&path) => match ledger_state(&path, thread_id) {
            // Builds before the ledger wrote bare `<id>` markers on Windows too;
            // one that still exists keeps denying until fresh consent clears it.
            _ if legacy_marker_blocks(&path) => denied(),
            LedgerState::Confirmed(confirmed_grant) => {
                confirmed_grant.intersect(grant).unwrap_or_else(|_| denied())
            }
            LedgerState::Denied => denied(),
        },
        Some(path) => match std::fs::symlink_metadata(path) {
            Ok(_) => denied(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => grant,
            Err(_) => denied(),
        },
        // No consent root installed: nothing durable can vouch for the grant.
        None if cfg!(unix) => grant,
        None => denied(),
    };
    // A revoke/clear can publish while the marker lookup is blocked.
    let mut map = confirmed().lock().unwrap();
    map.entry(thread_id.to_string())
        .or_insert_with(|| Confirmed {
            grant: restored,
            generation: next_generation(),
            durability_error: None,
            denial_token: None,
        });
    Ok(())
}
const LEDGER_SUFFIX: &str = ".ledger";
/// Compact in place beyond this size. Safe without rename/dir-sync: an empty or
/// torn ledger is a denial, and the lone record written is flushed.
const LEDGER_COMPACT_BYTES: u64 = 64 * 1024;
/// Restore never reads more than this. Jan's own appends keep a ledger under
/// `LEDGER_COMPACT_BYTES` plus one record, so anything larger is foreign or
/// corrupt: deny, and the next append compacts it away without reading it.
const LEDGER_READ_MAX: u64 = 1024 * 1024;

/// Test-only per-path fault injection for the ledger: `(op, stage)` where
/// stage is "write" (nothing written) or "sync" (record written, flush failed,
/// i.e. the record may still persist late).
#[cfg(test)]
type LedgerFault = Arc<dyn Fn(LedgerOp, &str) -> bool + Send + Sync>;
#[cfg(test)]
fn ledger_faults() -> &'static Mutex<HashMap<PathBuf, LedgerFault>> {
    static FAULTS: OnceLock<Mutex<HashMap<PathBuf, LedgerFault>>> = OnceLock::new();
    FAULTS.get_or_init(Default::default)
}
#[cfg(test)]
fn ledger_fault(path: &std::path::Path, op: LedgerOp, stage: &str) -> Result<(), String> {
    let fault = ledger_faults().lock().unwrap().get(path).cloned();
    match fault {
        Some(f) if f(op, stage) => Err(format!("injected {stage} failure")),
        _ => Ok(()),
    }
}

fn is_ledger(path: &std::path::Path) -> bool {
    path.extension().is_some_and(|e| e == "ledger")
}

fn legacy_marker(ledger: &std::path::Path) -> PathBuf {
    ledger.with_extension("")
}
fn legacy_marker_blocks(ledger: &std::path::Path) -> bool {
    match std::fs::symlink_metadata(legacy_marker(ledger)) {
        Ok(_) => true,
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    }
}
/// Called only after a flushed CONFIRM. Removal need not be durable: a marker
/// resurrected by a crash merely denies, which is the safe direction.
fn remove_legacy_marker(ledger: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(legacy_marker(ledger)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
enum LedgerOp {
    Confirm,
    Deny,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LedgerRecord {
    v: u8,
    op: LedgerOp,
    id: String,
    grant: Option<ThreadCapabilities>,
}

enum LedgerState {
    Confirmed(ThreadCapabilities),
    Denied,
}

/// FNV-1a 64: detects torn/zero-filled/garbled records; not an authenticator.
fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}

fn encode_record(id: &str, op: LedgerOp, grant: Option<&ThreadCapabilities>) -> Result<Vec<u8>, String> {
    let json = serde_json::to_string(&LedgerRecord {
        v: 1,
        op,
        id: id.to_string(),
        grant: grant.cloned(),
    })
    .map_err(|e| e.to_string())?;
    Ok(format!("{:016x} {json}\n", checksum(json.as_bytes())).into_bytes())
}

fn decode_record(line: &[u8], id: &str) -> Option<LedgerRecord> {
    let line = std::str::from_utf8(line).ok()?;
    let (sum, json) = line.split_once(' ')?;
    if sum.len() != 16 || u64::from_str_radix(sum, 16).ok()? != checksum(json.as_bytes()) {
        return None;
    }
    let record: LedgerRecord = serde_json::from_str(json).ok()?;
    let well_formed = record.v == 1
        && record.id == id
        && match (&record.op, &record.grant) {
            (LedgerOp::Confirm, Some(grant)) => grant.validate().is_ok(),
            (LedgerOp::Deny, None) => true,
            _ => false,
        };
    well_formed.then_some(record)
}

/// Restore needs a positive answer: the last valid record is a CONFIRM for this
/// identity and nothing invalid (torn, zero-filled, foreign) follows it. Missing,
/// unreadable, empty, or a non-file ledger all deny.
fn ledger_state(path: &std::path::Path, id: &str) -> LedgerState {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return LedgerState::Denied;
    };
    // Bounded: never read more than the cap, and an over-cap ledger denies.
    let mut bytes = Vec::new();
    if file.take(LEDGER_READ_MAX + 1).read_to_end(&mut bytes).is_err()
        || bytes.len() as u64 > LEDGER_READ_MAX
    {
        return LedgerState::Denied;
    }
    let mut last = None;
    let mut invalid_after = false;
    for line in bytes.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        match decode_record(line, id) {
            Some(record) => {
                last = Some(record);
                invalid_after = false;
            }
            None => invalid_after = true,
        }
    }
    match last {
        Some(LedgerRecord { op: LedgerOp::Confirm, grant: Some(grant), .. }) if !invalid_after => {
            LedgerState::Confirmed(grant)
        }
        _ => LedgerState::Denied,
    }
}

/// Append one record and flush that file (FlushFileBuffers on Windows). No
/// directory sync is assumed: if a newly created ledger vanishes after power
/// loss, absence is a denial, which is the safe direction.
fn ledger_append(
    path: &std::path::Path,
    id: &str,
    op: LedgerOp,
    grant: Option<&ThreadCapabilities>,
) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom, Write};
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut record = encode_record(id, op, grant)?;
    // Plain write access (not `append`): on Windows `append(true)` alone
    // requests FILE_GENERIC_WRITE without FILE_WRITE_DATA, while
    // FlushFileBuffers documents GENERIC_WRITE. We seek to the end ourselves,
    // which is race-free only because every caller holds this identity's I/O
    // lock; a second process could at worst damage a record, which denies.
    // Never truncate on open: the existing ledger is the revocation history.
    // Compaction below is the only place it is emptied, via explicit `set_len`.
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len > LEDGER_COMPACT_BYTES {
        // Compact without reading: only the last word counts, and an empty or
        // torn ledger denies until the lone record below is flushed.
        file.set_len(0).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    } else if len > 0 {
        // Never glue a record onto a torn tail: peek at the last byte only.
        let mut last = [0u8; 1];
        file.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        file.read_exact(&mut last).map_err(|e| e.to_string())?;
        if last[0] != b'\n' {
            record.insert(0, b'\n');
        }
    }
    file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    #[cfg(test)]
    ledger_fault(path, op, "write")?;
    file.write_all(&record).map_err(|e| e.to_string())?;
    #[cfg(test)]
    ledger_fault(path, op, "sync")?;
    file.sync_all().map_err(|e| e.to_string())
}
/// Why a denial is not (known to be) durable. All variants are sticky: only a
/// successful denial append (`persist_denial_at`) or a flushed fresh CONFIRM
/// clears them, and none of them ever loosens the in-process denial.
#[derive(Clone, Debug)]
enum Fault {
    Pending,
    /// A revocation's DENY could not be written or flushed.
    RevocationFailed(String),
    /// A grant confirmation failed but the compensating DENY was durable: the
    /// user's grant was not activated and the last word on disk is a denial.
    ConfirmFailed(String),
    /// A grant confirmation failed AND the compensating DENY failed: the
    /// CONFIRM may persist late, so the grant may return after a crash.
    ConfirmRollbackFailed { confirm: String, rollback: String },
}

impl Fault {
    fn message(&self) -> String {
        let revocation = "Access denied in this process, but restart-safe revocation failed";
        match self {
            Fault::Pending => format!("{revocation}: Denial persistence is pending"),
            Fault::RevocationFailed(e) => format!("{revocation}: {e}"),
            Fault::ConfirmFailed(e) => format!(
                "Access stays denied: the grant confirmation failed ({e}) and a durable denial was recorded"
            ),
            Fault::ConfirmRollbackFailed { confirm, rollback } => format!(
                "{revocation}: the grant confirmation failed ({confirm}) and its compensating denial also failed ({rollback}); \
                 access is off now, but the confirmation may persist and the grant may return after a crash"
            ),
        }
    }
}

/// Err for EVERY sticky fault, including a failed grant confirmation whose
/// compensating DENY was durable: the barrier is deliberately not relaxed
/// (delete and the setter still refuse until a fresh denial or confirm clears
/// it). The message differs by kind; `confirm_failure` exposes the grant-side
/// kinds so hosts can word them as "grant not activated", not "revocation failed".
pub fn denial_persisted(thread_id: &str) -> Result<(), String> {
    let map = confirmed().lock().unwrap();
    match map.get(thread_id).and_then(|e| e.durability_error.as_ref()) {
        Some(fault) => Err(fault.message()),
        None => Ok(()),
    }
}

/// Why the last grant confirmation failed, while the entry still shows it.
pub fn confirm_failure(thread_id: &str) -> Option<String> {
    match confirmed().lock().unwrap().get(thread_id)?.durability_error.as_ref()? {
        fault @ (Fault::ConfirmFailed(_) | Fault::ConfirmRollbackFailed { .. }) => Some(fault.message()),
        _ => None,
    }
}

/// The failed-confirmation message and the rollback flag from ONE lock
/// acquisition, so a concurrent stop-all or revoke that replaces the entry can
/// never pair a message from one entry with a flag from another.
pub fn confirm_failure_snapshot(thread_id: &str) -> (Option<String>, bool) {
    let map = confirmed().lock().unwrap();
    match map.get(thread_id).and_then(|e| e.durability_error.as_ref()) {
        Some(fault @ Fault::ConfirmFailed(_)) => (Some(fault.message()), false),
        Some(fault @ Fault::ConfirmRollbackFailed { .. }) => (Some(fault.message()), true),
        _ => (None, false),
    }
}

/// True when a failed grant confirmation could not be rolled back with a
/// durable denial. The host's second durable channel (narrowing metadata)
/// should be used, and the user told the outcome is unknown, not "not granted".
pub fn confirm_rollback_failed(thread_id: &str) -> bool {
    matches!(
        confirmed().lock().unwrap().get(thread_id).and_then(|e| e.durability_error.as_ref()),
        Some(Fault::ConfirmRollbackFailed { .. })
    )
}

struct Confirmed {
    grant: ThreadCapabilities,
    generation: u64,
    durability_error: Option<Fault>,
    // Unlike the admission generation, survives stop/finalize barrier bumps.
    denial_token: Option<u64>,
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

/// Whether a spawn authorized at `generation` may start now. Called under the
/// [`admission`] guard, immediately before the spawn registers its child.
///
/// Two things can have moved since the poll was authorized, and either skips
/// the spawn: the thread's own barrier (a revoke or stop), and the app-wide
/// network switch. The global setting does not advance any thread's generation,
/// so a poll whose sandbox was built with network on -- sampled before its
/// PreToolUse hooks ran, perhaps long before -- would otherwise spawn with
/// network after the user switched it off. `network` is whether the spawn's
/// sandbox grants network; a spawn without it is unaffected by the switch.
pub fn spawn_authorized(thread_id: &str, generation: u64, network: bool) -> bool {
    spawn_authorized_under(thread_id, generation, network, get_global_grants())
}

fn spawn_authorized_under(
    thread_id: &str,
    generation: u64,
    network: bool,
    global: GlobalGrants,
) -> bool {
    self::generation(thread_id) == generation && (!network || global.shell_network)
}

/// Blocking compatibility entry point: drop elevations and persist denial.
/// Async hosts use `deny_in_memory` under admission, then `persist_denial_async`.
/// Never call this while holding spawn admission.
/// Callers narrow BEFORE persisting, so a failed or lost write can never
/// leave an earlier confirmation live.
pub fn narrow(thread_id: &str) -> u64 {
    let generation = deny_in_memory(thread_id);
    persist_denial(thread_id, generation);
    generation
}

/// Synchronous barrier used under spawn admission. No filesystem work or
/// per-identity I/O lock: even a stalled confirmation cannot delay denial.
pub fn deny_in_memory(thread_id: &str) -> u64 {
    let mut map = confirmed().lock().unwrap();
    let generation = next_generation();
    map.insert(
        thread_id.to_string(),
        Confirmed {
            grant: denied(),
            generation,
            durability_error: Some(Fault::Pending),
            denial_token: Some(generation),
        },
    );
    generation
}

/// Complete a published denial outside admission, on a blocking worker.
/// A newer operation may have overtaken this one while it waited for I/O.
pub fn persist_denial(thread_id: &str, token: u64) {
    persist_denial_at(thread_id, token, marker(thread_id));
}
fn persist_denial_at(thread_id: &str, token: u64, marker_path: Result<Option<PathBuf>, String>) {
    let lock = marker_lock(thread_id);
    let _io = lock.lock().unwrap();
    // A denial has no authority to restore: an overtaken caller may safely
    // persist the latest denial while holding this identity's I/O lock. A
    // confirmation cannot remove the marker until we release that lock. Do
    // not acknowledge by admission generation: stop/finalize may bump it.
    let _ = token; // Only confirmations, never denial writes, consume tokens.
    if confirmed().lock().unwrap().get(thread_id)
        .and_then(|e| e.denial_token).is_none()
    {
        return;
    }
    let error = marker_path
        .and_then(|path| write_denial_at(thread_id, path))
        .err();
    let mut map = confirmed().lock().unwrap();
    if let Some(entry) = map.get_mut(thread_id).filter(|e| e.denial_token.is_some()) {
        // A failed retry does not resolve an earlier ambiguous confirmation.
        // Keep its stronger diagnostic until a DENY actually persists.
        if error.is_none()
            || !matches!(entry.durability_error, Some(Fault::ConfirmRollbackFailed { .. }))
        {
            entry.durability_error = error.map(Fault::RevocationFailed);
        }
    }
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
    confirm_at(thread_id, grant, token, marker(thread_id))
}
fn confirm_at(
    thread_id: &str,
    grant: ThreadCapabilities,
    token: u64,
    marker_path: Result<Option<PathBuf>, String>,
) -> bool {
    if token == 0 || grant.validate().is_err() {
        return false;
    }
    let Ok(marker_path) = marker_path else {
        return false;
    };
    let lock = marker_lock(thread_id);
    let _io = lock.lock().unwrap();
    if confirmed()
        .lock()
        .unwrap()
        .get(thread_id)
        .map(|e| e.generation)
        != Some(token)
    {
        return false;
    }
    #[cfg(test)]
    before_io(thread_id, "remove");
    let acknowledged = match marker_path.as_deref() {
        // Append a flushed CONFIRM; on failure re-append a DENY so a record the
        // OS persists late can never be the last word. If that compensating
        // DENY fails too the outcome is unknown: report it, stickily.
        Some(path) if is_ledger(path) => {
            match ledger_append(path, thread_id, LedgerOp::Confirm, Some(&grant))
                .and_then(|()| remove_legacy_marker(path))
            {
                Ok(()) => Ok(()),
                Err(confirm) => Err(match write_denial_at(thread_id, marker_path.clone()) {
                    Ok(()) => Fault::ConfirmFailed(confirm),
                    Err(rollback) => Fault::ConfirmRollbackFailed { confirm, rollback },
                }),
            }
        }
        _ => remove_denial_at(thread_id, marker_path.clone()),
    };
    if let Err(fault) = acknowledged {
        // Directory-sync failure may also have failed to recreate the marker.
        // Do not let deletion acknowledge an earlier, now-removed denial.
        if let Some(entry) = confirmed().lock().unwrap().get_mut(thread_id) {
            entry.durability_error = Some(fault);
        }
        return false;
    }
    {
        let mut map = confirmed().lock().unwrap();
        if map.get(thread_id).map(|e| e.generation) == Some(token) {
            map.insert(
                thread_id.to_string(),
                Confirmed {
                    grant,
                    generation: next_generation(),
                    durability_error: None,
                    denial_token: None,
                },
            );
            return true;
        }
    }
    // A synchronous deny/clear overtook removal. Repair BEFORE releasing I/O
    // serialization so no stale removal can erase its durable denial. Never
    // hold the process-wide mirror during even this exceptional write.
    let error = write_denial_at(thread_id, marker_path).err();
    let mut map = confirmed().lock().unwrap();
    if let Some(entry) = map.get_mut(thread_id) {
        entry.durability_error = error.map(Fault::RevocationFailed);
    }
    false
}

/// Host entry points keep filesystem latency off async runtime workers.
/// Resolve the host root before dispatch (it may be runtime/thread-local);
/// workers receive an owned marker path, never re-resolve a different root.
pub async fn confirm_async(thread_id: String, grant: ThreadCapabilities, token: u64) -> bool {
    let path = marker(&thread_id);
    tokio::task::spawn_blocking(move || confirm_at(&thread_id, grant, token, path))
        .await
        .unwrap_or(false)
}
pub async fn restore_async(thread_id: String, grant: ThreadCapabilities) -> Result<(), String> {
    let path = marker(&thread_id)?;
    tokio::task::spawn_blocking(move || restore_at(&thread_id, grant, path))
        .await
        .map_err(|e| e.to_string())?
}
pub async fn persist_denial_async(thread_id: String, token: u64) {
    // A failed worker leaves the synchronous pending error in place (fail closed).
    let path = marker(&thread_id);
    let _ = tokio::task::spawn_blocking(move || persist_denial_at(&thread_id, token, path)).await;
}

/// Finalize a deleted identity in memory, preserving the durable denial (and
/// any durability error) already installed by the pre-removal revoke. Markers
/// deliberately have no age/count GC: deleted ids can be reused and stale
/// backups can reintroduce old grants indefinitely. Safe bounded GC requires
/// a durable identity epoch/tombstone outside restorable thread metadata;
/// absent that, only explicit current consent may remove a marker. No I/O
/// is allowed here: the record is gone, so failure could create a UI ghost.
/// Advance the barrier even for an already denied entry, invalidating stale
/// confirmations and monitor polls racing with finalization.
pub fn clear(thread_id: &str) -> u64 {
    let mut map = confirmed().lock().unwrap();
    let entry = map
        .entry(thread_id.to_string())
        .or_insert_with(|| Confirmed {
            grant: denied(),
            generation: 0,
            durability_error: None,
            denial_token: None,
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
pub async fn authorize(thread_id: &str) -> Result<(PathBuf, ThreadCapabilities, u64), String> {
    let snapshot = snapshot(thread_id.to_string()).await?;
    combine_snapshot(thread_id, snapshot)
}

/// Host-owned folder authority of a migrated Cowork conversation. A separate
/// resolver from [`set_resolver`] so the Chat-only surface can never be handed
/// a Cowork record by mistake.
static COWORK_RESOLVER: OnceLock<SnapshotResolver> = OnceLock::new();
pub fn set_cowork_resolver(resolver: SnapshotResolver) {
    let _ = COWORK_RESOLVER.set(resolver);
}

/// [`authorize`] for a host-verified Cowork thread. `None` means the host
/// holds NO folder record for it (a legacy or never-narrowed conversation):
/// the folder is inactive and the caller must not use it as read+write. Once a
/// record exists -- including `folderScope: null` after a detach -- it is the
/// ceiling, intersected with the same process confirmation, so a revoke or
/// detach narrows immediately and nothing resurrects the old folder.
pub async fn authorize_cowork(
    thread_id: &str,
) -> Result<(PathBuf, Option<ThreadCapabilities>, u64), String> {
    let (data_folder, stored) = COWORK_RESOLVER
        .get()
        .ok_or("Cowork consent resolver is unavailable")?(thread_id.to_string())
    .await?;
    if stored.is_null() {
        // No record is the inactive legacy state while nothing says otherwise.
        // A revoke whose record write failed leaves a process entry and/or a
        // durable denial; either keeps the folder off (fail closed) with the
        // mirror, never a read+write fallback.
        if confirmed().lock().unwrap().contains_key(thread_id) || denial_evidence(thread_id) {
            let (mirror, generation) = current(thread_id);
            return Ok((data_folder, Some(mirror), generation));
        }
        return Ok((data_folder, None, generation(thread_id)));
    }
    let (data_folder, grant, generation) = combine_snapshot(thread_id, (data_folder, stored))?;
    Ok((data_folder, Some(grant), generation))
}

/// Whether the durable denial store holds anything for this identity (a Unix
/// marker or a Windows ledger / legacy marker). Unreadable counts as present.
fn denial_evidence(thread_id: &str) -> bool {
    let Ok(Some(path)) = marker(thread_id) else {
        return false;
    };
    let present = |p: &std::path::Path| match std::fs::symlink_metadata(p) {
        Ok(_) => true,
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    };
    present(&path)
        || present(&path.with_extension("ledger"))
        || present(&path.with_extension(""))
}

fn combine_snapshot(
    thread_id: &str,
    (data_folder, stored): (PathBuf, serde_json::Value),
) -> Result<(PathBuf, ThreadCapabilities, u64), String> {
    let stored: ThreadCapabilities = serde_json::from_value(stored)
        .map_err(|e| format!("Invalid stored conversation capabilities: {e}"))?;
    let (mirror, generation) = current(thread_id);
    Ok((
        data_folder,
        stored
            .with_global(thread_id)
            .intersect(mirror.with_global(thread_id))?,
        generation,
    ))
}
/// Clamp what a legacy Session caller asked for to the host's authority for a
/// Cowork conversation. The caller's values may only narrow: a different or
/// revoked folder is an error (never a silent drop, or the agent would work
/// against a folder it believes is attached), and writes need both the caller
/// and the host to say `write`.
pub fn clamp_session_folder(
    host: &ThreadCapabilities,
    folder: Option<&str>,
    writable: Option<bool>,
) -> Result<(Option<String>, Option<bool>), String> {
    let Some(folder) = folder else {
        return Ok((None, writable.map(|_| false)));
    };
    match &host.folder_scope {
        Some(granted) if granted.path == folder => Ok((
            Some(folder.to_string()),
            Some(writable.unwrap_or(false) && granted.access == "write"),
        )),
        _ => Err("Folder access for this conversation changed: the attached folder is no \
                  longer granted"
            .into()),
    }
}

/// The ceiling a Cowork monitor captured at start: what the caller asked for.
pub fn session_ceiling(
    folder: Option<&str>,
    writable: bool,
    network: bool,
) -> ThreadCapabilities {
    ThreadCapabilities {
        version: 1,
        folder_scope: folder.map(|path| FolderScope {
            path: path.to_string(),
            access: if writable { "write" } else { "read" }.into(),
        }),
        shell_network: network,
        memory_write: false,
    }
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

    /// Lexical fixtures only: no directory needs to exist for capability validation.
    fn absolute_fixture(name: &str) -> String {
        let path = std::env::temp_dir()
            .join("jan-capability-fixtures")
            .join(name);
        assert!(
            path.is_absolute(),
            "fixture must be absolute on this platform"
        );
        path.to_string_lossy().into_owned()
    }

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
    /// R6: a poll authorized with network on must not spawn once the app-wide
    /// switch is off, although no thread generation moved.
    #[test]
    fn spawn_admission_rechecks_the_global_network_switch() {
        let on = GlobalGrants { shell_network: true, memory_write: true };
        let off = GlobalGrants { shell_network: false, ..on };
        let id = "spawn-admission-global";
        let token = generation(id);
        assert!(spawn_authorized_under(id, token, true, on), "positive control");
        assert!(!spawn_authorized_under(id, token, true, off), "network revoked after sampling");
        assert!(spawn_authorized_under(id, token, false, off), "a no-network spawn is unaffected");
        assert!(!spawn_authorized_under(id, token + 1, false, on), "the thread barrier still applies");
    }
    #[test]
    fn intersection_never_widens_disk_or_local_revocation() {
        for (stored, effective) in [(false, true), (true, false)] {
            let result = grant(stored, None, "read")
                .intersect(grant(effective, Some(&absolute_fixture("forged")), "write"))
                .unwrap();
            assert!(!result.shell_network);
            assert!(!result.memory_write);
            assert!(result.folder_scope.is_none());
        }
        let result = grant(true, Some(&absolute_fixture("stored")), "read")
            .intersect(grant(true, Some(&absolute_fixture("stored")), "write"))
            .unwrap();
        assert_eq!(result.folder_scope.unwrap().access, "read");
        let result = grant(true, Some(&absolute_fixture("stored")), "write")
            .intersect(grant(true, Some(&absolute_fixture("different")), "write"))
            .unwrap();
        assert!(result.folder_scope.is_none());
    }
    #[test]
    fn validation_requires_absolute_paths_and_supported_schema() {
        let valid = grant(true, Some(&absolute_fixture("stored")), "write");
        valid.validate().unwrap();
        for invalid in [
            grant(true, Some("relative-folder"), "write"),
            grant(true, Some(&absolute_fixture("stored")), "execute"),
            ThreadCapabilities {
                version: 2,
                ..valid.clone()
            },
        ] {
            assert!(invalid.validate().is_err());
            assert!(valid.clone().intersect(invalid.clone()).is_err());
            assert!(invalid.intersect(valid.clone()).is_err());
        }
    }

    #[tokio::test]
    async fn missing_host_resolver_fails_closed() {
        assert!(snapshot("chat".into()).await.is_err());
    }

    fn elevated() -> ThreadCapabilities {
        grant(true, Some(&absolute_fixture("stored")), "write")
    }

    fn is_denied(caps: &ThreadCapabilities) -> bool {
        !caps.shell_network && !caps.memory_write && caps.folder_scope.is_none()
    }

    #[test]
    fn slow_marker_io_does_not_block_other_threads() {
        use std::sync::mpsc;
        use std::time::Duration;
        let id = "slow-marker-write";
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        io_hooks().lock().unwrap().insert(
            id.into(),
            Arc::new(move |_| {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }),
        );
        let writer = std::thread::spawn(move || narrow(id));
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (read_tx, read_rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            let _ = current("unrelated-responsive");
            let _ = generation("unrelated-responsive");
            read_tx.send(()).unwrap();
        });
        let responsive = read_rx.recv_timeout(Duration::from_secs(1)).is_ok();
        release_tx.send(()).unwrap();
        writer.join().unwrap();
        reader.join().unwrap();
        io_hooks().lock().unwrap().remove(id);
        assert!(responsive, "marker I/O held the process-wide mirror mutex");
    }

    #[cfg(feature = "tauri")]
    #[tokio::test(flavor = "current_thread")]
    async fn slow_revoke_releases_admission_and_async_worker() {
        use std::sync::mpsc;
        use std::time::Duration;
        let id = "async-slow-revoke";
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let entered_tx = Mutex::new(Some(entered_tx));
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        io_hooks().lock().unwrap().insert(
            id.into(),
            Arc::new(move |_| {
                if let Some(tx) = entered_tx.lock().unwrap().take() {
                    let _ = tx.send(());
                }
                release_rx.lock().unwrap().recv().unwrap();
            }),
        );
        let revoke = tokio::spawn(crate::commands::revoke_thread_consent(id));
        tokio::time::timeout(Duration::from_secs(5), entered_rx)
            .await
            .unwrap()
            .unwrap();
        assert!(is_denied(&current(id).0));
        let admission_free = admission().try_lock().is_ok();
        release_tx.send(()).unwrap();
        revoke.await.unwrap();
        io_hooks().lock().unwrap().remove(id);
        assert!(
            admission_free,
            "durability work must not hold spawn admission"
        );
        denial_persisted(id).unwrap();
    }

    #[test]
    fn overtaken_denial_persists_latest_without_confirming_stale_token() {
        let id = "overtaken-denial";
        let root = std::env::temp_dir().join(format!("jan-overtaken-{}", std::process::id()));
        let path = root.join("markers").join(id);
        let first = deny_in_memory(id);
        let newer = deny_in_memory(id);
        persist_denial_at(id, first, Ok(Some(path.clone())));
        denial_persisted(id).expect("overtaken caller must complete the latest denial");
        assert!(path.exists());
        assert_eq!(generation(id), newer);
        assert!(!confirm_at(id, elevated(), first, Ok(Some(path.clone()))));
        assert!(is_denied(&current(id).0));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn denial_published_during_marker_write_is_acknowledged() {
        use std::sync::mpsc;
        use std::time::Duration;
        let id = "pending-during-marker-write";
        let root = std::env::temp_dir().join(format!("jan-pending-write-{}", std::process::id()));
        let path = root.join("markers").join(id);
        let first = deny_in_memory(id);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        io_hooks().lock().unwrap().insert(id.into(), Arc::new(move |op| {
            if op == "write" {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }
        }));
        let worker_path = path.clone();
        let worker = std::thread::spawn(move || persist_denial_at(id, first, Ok(Some(worker_path))));
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let newer = deny_in_memory(id);
        assert!(denial_persisted(id).unwrap_err().contains("pending"));
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        io_hooks().lock().unwrap().remove(id);
        denial_persisted(id).expect("completed marker write acknowledges the newly published denial");
        assert!(path.is_file());
        assert_eq!(generation(id), newer);
        assert!(is_denied(&current(id).0));
        assert!(!confirm_at(id, elevated(), first, Ok(Some(path))));
        std::fs::remove_dir_all(root).unwrap();
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
        assert!(
            caps.shell_network,
            "the grant survives a stop, unlike a revoke"
        );
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
        assert_ne!(
            generation, 0,
            "a deleted identity retains an explicit denial barrier"
        );
        assert!(!confirm_if_current(id, elevated(), token));
        assert!(is_denied(&current(id).0));
    }

    /// The Windows backend is portable std code, so it is exercised on every
    /// platform through explicit `.ledger` paths (the path selects the backend).
    mod ledger {
        use super::*;

        struct Dir(PathBuf);
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        fn dir() -> Dir {
            // A process-wide counter: parallel tests starting within one clock
            // tick must never share (and delete) each other's directory.
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "jan-ledger-test-{}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Dir(path)
        }
        fn restart(id: &str) {
            confirmed().lock().unwrap().remove(id);
        }
        fn restore(id: &str, path: &std::path::Path, stored: ThreadCapabilities) -> ThreadCapabilities {
            restart(id);
            restore_at(id, stored, Some(path.to_path_buf())).unwrap();
            current(id).0
        }
        fn confirm(id: &str, path: &std::path::Path, grant: ThreadCapabilities) -> bool {
            let token = deny_in_memory(id);
            persist_denial_at(id, token, Ok(Some(path.to_path_buf())));
            confirm_at(id, grant, token, Ok(Some(path.to_path_buf())))
        }

        #[test]
        fn confirmed_grant_restores_after_restart_and_never_widens() {
            let d = dir();
            let (id, path) = ("ledger-restore", d.0.join("ledger-restore.ledger"));
            assert!(confirm(id, &path, elevated()));
            assert_eq!(restore(id, &path, elevated()).folder_scope.unwrap().access, "write");
            // Stored metadata narrowed to read since: the intersection wins.
            let mut read_only = elevated();
            read_only.folder_scope.as_mut().unwrap().access = "read".into();
            assert_eq!(restore(id, &path, read_only).folder_scope.unwrap().access, "read");
            // A different stored folder than the one confirmed never restores.
            let other = grant(true, Some(&absolute_fixture("other")), "write");
            assert!(restore(id, &path, other).folder_scope.is_none());
            // A ledger confirmed read-only never widens to a stored write grant.
            let mut narrow_grant = elevated();
            narrow_grant.folder_scope.as_mut().unwrap().access = "read".into();
            assert!(confirm(id, &path, narrow_grant));
            assert_eq!(restore(id, &path, elevated()).folder_scope.unwrap().access, "read");
        }

        #[test]
        fn missing_empty_or_garbage_ledgers_fail_closed() {
            let d = dir();
            let id = "ledger-missing";
            let path = d.0.join("ledger-missing.ledger");
            assert!(is_denied(&restore(id, &path, elevated())), "no ledger");
            std::fs::write(&path, b"").unwrap();
            assert!(is_denied(&restore(id, &path, elevated())), "empty");
            std::fs::write(&path, vec![0u8; 512]).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())), "zero-filled");
            std::fs::write(&path, b"{\"v\":1,\"op\":\"confirm\"}\n").unwrap();
            assert!(is_denied(&restore(id, &path, elevated())), "no checksum");
            std::fs::remove_file(&path).unwrap();
            std::fs::create_dir(&path).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())), "unreadable");
        }

        #[test]
        fn deny_is_last_word_and_survives_restart() {
            let d = dir();
            let (id, path) = ("ledger-deny", d.0.join("ledger-deny.ledger"));
            assert!(confirm(id, &path, elevated()));
            let token = deny_in_memory(id);
            persist_denial_at(id, token, Ok(Some(path.clone())));
            denial_persisted(id).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            // Only a fresh positive confirmation lifts it.
            assert!(confirm(id, &path, elevated()));
            assert!(!is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn torn_or_foreign_records_after_a_confirm_deny() {
            let d = dir();
            let (id, path) = ("ledger-torn", d.0.join("ledger-torn.ledger"));
            assert!(confirm(id, &path, elevated()));
            let good = std::fs::read(&path).unwrap();
            // Torn tail (crash mid-append of a later DENY).
            let mut torn = good.clone();
            torn.extend_from_slice(b"00000000deadbeef {\"v\":1,\"op\":\"de");
            std::fs::write(&path, &torn).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            // A tampered record fails its checksum.
            let tampered = String::from_utf8(good.clone()).unwrap().replace("write", "wr1te");
            std::fs::write(&path, tampered).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            // A valid confirm copied from another identity's ledger is rejected.
            std::fs::write(&path, String::from_utf8(good).unwrap()).unwrap();
            assert!(!is_denied(&restore("ledger-torn", &path, elevated())));
            assert!(is_denied(&restore("ledger-other", &path, elevated())));
        }

        #[test]
        fn failed_confirm_never_acknowledges_and_next_append_survives_torn_tail() {
            let d = dir();
            let (id, path) = ("ledger-io", d.0.join("ledger-io.ledger"));
            std::fs::create_dir(&path).unwrap();
            assert!(!confirm(id, &path, elevated()), "unwritable ledger");
            assert!(is_denied(&current(id).0));
            std::fs::remove_dir(&path).unwrap();
            std::fs::write(&path, b"torn-without-newline").unwrap();
            assert!(confirm(id, &path, elevated()), "append repairs the torn tail");
            assert!(!is_denied(&restore(id, &path, elevated())));
            // A torn tail left after the confirm still denies.
            let mut bytes = std::fs::read(&path).unwrap();
            bytes.extend_from_slice(b"junk");
            std::fs::write(&path, bytes).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn legacy_marker_keeps_denying_until_fresh_consent() {
            let d = dir();
            let (id, path) = ("ledger-legacy", d.0.join("ledger-legacy.ledger"));
            assert!(confirm(id, &path, elevated()));
            std::fs::write(d.0.join("ledger-legacy"), b"").unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            assert!(confirm(id, &path, elevated()));
            assert!(!d.0.join("ledger-legacy").exists());
            assert!(!is_denied(&restore(id, &path, elevated())));
        }

        fn inject(path: &std::path::Path, fault: impl Fn(LedgerOp, &str) -> bool + Send + Sync + 'static) {
            ledger_faults().lock().unwrap().insert(path.to_path_buf(), Arc::new(fault));
        }
        fn clear_faults(path: &std::path::Path) {
            ledger_faults().lock().unwrap().remove(path);
        }
        fn lines(path: &std::path::Path) -> Vec<String> {
            String::from_utf8(std::fs::read(path).unwrap())
                .unwrap()
                .lines()
                .map(|l| l.to_string())
                .collect()
        }
        /// Revocation-then-grant as the host setter does it, but with the denial
        /// persisted first (as the setter requires) and a caller-chosen fault.
        fn begin(id: &str, path: &std::path::Path) -> u64 {
            let token = deny_in_memory(id);
            persist_denial_at(id, token, Ok(Some(path.to_path_buf())));
            denial_persisted(id).expect("denial durable before any grant");
            token
        }

        #[test]
        fn failed_confirm_with_durable_compensating_denial_is_a_grant_failure() {
            let d = dir();
            let (id, path) = ("ledger-grant-fail", d.0.join("ledger-grant-fail.ledger"));
            let token = begin(id, &path);
            // Flush of the CONFIRM fails after the record was written.
            inject(&path, |op, stage| op == LedgerOp::Confirm && stage == "sync");
            assert!(!confirm_at(id, elevated(), token, Ok(Some(path.clone()))));
            clear_faults(&path);
            assert!(is_denied(&current(id).0), "in-process stays denied");
            assert!(!confirm_rollback_failed(id));
            let why = confirm_failure(id).expect("grant-side failure is reported");
            assert!(why.contains("grant confirmation failed"), "{why}");
            assert!(!why.contains("may return"), "{why}");
            assert_eq!(confirm_failure_snapshot(id), (Some(why.clone()), false));
            // Fail-closed barrier is NOT relaxed: setter/delete guards still refuse.
            assert!(denial_persisted(id).is_err());
            // The compensating DENY is the last word, so restore stays denied.
            assert!(lines(&path).last().unwrap().contains("\"op\":\"deny\""));
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn failed_confirm_write_leaves_no_confirm_record() {
            let d = dir();
            let (id, path) = ("ledger-write-fail", d.0.join("ledger-write-fail.ledger"));
            let token = begin(id, &path);
            let before = lines(&path).len();
            inject(&path, |op, stage| op == LedgerOp::Confirm && stage == "write");
            assert!(!confirm_at(id, elevated(), token, Ok(Some(path.clone()))));
            clear_faults(&path);
            assert!(lines(&path).iter().all(|l| !l.contains("\"op\":\"confirm\"")));
            assert_eq!(lines(&path).len(), before + 1, "only the compensating denial");
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn failed_compensating_denial_is_a_sticky_distinct_error() {
            let d = dir();
            let (id, path) = ("ledger-rollback-fail", d.0.join("ledger-rollback-fail.ledger"));
            let token = begin(id, &path);
            // CONFIRM is written but its flush fails, and so does the repair.
            inject(&path, |op, stage| match op {
                LedgerOp::Confirm => stage == "sync",
                LedgerOp::Deny => true,
            });
            assert!(!confirm_at(id, elevated(), token, Ok(Some(path.clone()))));
            assert!(is_denied(&current(id).0), "in-process stays denied");
            assert!(confirm_rollback_failed(id));
            let (msg, rolled) = confirm_failure_snapshot(id);
            assert!(rolled && msg.is_some_and(|m| m.contains("compensating denial also failed")));
            let error = denial_persisted(id).unwrap_err();
            assert!(error.contains("compensating denial also failed"), "{error}");
            assert!(error.contains("may persist and the grant may return after a crash"), "{error}");
            assert!(error.contains("restart-safe revocation failed"), "{error}");
            // Document the hazard honestly: the unflushed CONFIRM is on disk as the
            // last record here, so a crash that keeps it restores the grant.
            assert!(lines(&path).last().unwrap().contains("\"op\":\"confirm\""));
            // Sticky across barrier bumps, clear, and a failing retry.
            bump_generation(id);
            assert!(confirm_rollback_failed(id));
            persist_denial_at(id, token, Ok(Some(path.clone())));
            assert!(denial_persisted(id).is_err(), "failed retry stays an error");
            assert!(confirm_rollback_failed(id), "failed retry must retain the ambiguous-confirm diagnostic");
            // Only a successful denial append clears it, and then it is the last word.
            clear_faults(&path);
            let retry = deny_in_memory(id);
            persist_denial_at(id, retry, Ok(Some(path.clone())));
            denial_persisted(id).expect("successful DENY clears the sticky error");
            assert!(!confirm_rollback_failed(id));
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn confirm_failure_snapshot_pairs_message_and_flag_from_one_entry() {
            let d = dir();
            assert_eq!(confirm_failure_snapshot("snap-absent"), (None, false));
            let (id, path) = ("snap-rollback", d.0.join("snap-rollback.ledger"));
            let token = begin(id, &path);
            assert_eq!(confirm_failure_snapshot(id), (None, false));
            inject(&path, |op, stage| match op {
                LedgerOp::Confirm => stage == "sync",
                LedgerOp::Deny => true,
            });
            assert!(!confirm_at(id, elevated(), token, Ok(Some(path.clone()))));
            clear_faults(&path);
            let (msg, rolled) = confirm_failure_snapshot(id);
            assert!(rolled && msg.is_some_and(|m| m.contains("compensating denial also failed")));
            // The entry is replaced (a revoke or stop-all): message and flag
            // disappear together, never half-reported.
            narrow(id);
            let (msg, rolled) = confirm_failure_snapshot(id);
            assert_eq!(msg.is_some(), rolled);
        }

        #[test]
        fn rollback_failure_with_unwritable_ledger_never_acknowledges() {
            let d = dir();
            let (id, path) = ("ledger-dir-fail", d.0.join("ledger-dir-fail.ledger"));
            std::fs::create_dir(&path).unwrap();
            let token = deny_in_memory(id);
            assert!(!confirm_at(id, elevated(), token, Ok(Some(path.clone()))));
            assert!(confirm_rollback_failed(id));
            assert!(is_denied(&current(id).0));
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn appends_preserve_history_and_order_under_the_seeking_handle() {
            let d = dir();
            let (id, path) = ("ledger-order", d.0.join("ledger-order.ledger"));
            for _ in 0..3 {
                assert!(confirm(id, &path, elevated()));
            }
            let all = lines(&path);
            assert_eq!(all.len(), 6, "deny+confirm per round, nothing overwritten");
            for (i, line) in all.iter().enumerate() {
                let op = if i % 2 == 0 { "deny" } else { "confirm" };
                assert!(line.contains(&format!("\"op\":\"{op}\"")), "{i}: {line}");
            }
            // A rewound handle (e.g. cursor at 0) must still append, not overwrite.
            let token = deny_in_memory(id);
            persist_denial_at(id, token, Ok(Some(path.clone())));
            assert_eq!(lines(&path).len(), 7);
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn oversized_ledgers_are_never_fully_read_and_deny() {
            let d = dir();
            let (id, path) = ("ledger-huge", d.0.join("ledger-huge.ledger"));
            assert!(confirm(id, &path, elevated()));
            // A valid CONFIRM followed by > LEDGER_READ_MAX of foreign padding.
            let mut bytes = std::fs::read(&path).unwrap();
            bytes.extend(std::iter::repeat(b'x').take(LEDGER_READ_MAX as usize + 10));
            std::fs::write(&path, &bytes).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            // Even a stream of otherwise valid records over the cap denies.
            let good = encode_record(id, LedgerOp::Confirm, Some(&elevated())).unwrap();
            let flood: Vec<u8> = good.iter().copied().cycle().take(LEDGER_READ_MAX as usize + 1).collect();
            std::fs::write(&path, flood).unwrap();
            assert!(is_denied(&restore(id, &path, elevated())));
            // The next append compacts it (without reading it) to one flushed record.
            assert!(confirm(id, &path, elevated()));
            assert!(std::fs::metadata(&path).unwrap().len() < LEDGER_COMPACT_BYTES);
            // The helper appends DENY then CONFIRM; compaction dropped all history.
            let after = lines(&path);
            assert_eq!(after.len(), 2, "only the post-compaction records remain");
            assert!(after[0].contains("\"op\":\"deny\"") && after[1].contains("\"op\":\"confirm\""));
            assert!(!is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn stale_confirm_repairs_with_a_deny_and_reports_a_failed_repair() {
            use std::sync::mpsc;
            use std::time::Duration;
            for repair_fails in [false, true] {
                let d = dir();
                let id = format!("ledger-stale-{repair_fails}");
                let path = d.0.join(format!("{id}.ledger"));
                let token = begin(&id, &path);
                let (entered_tx, entered_rx) = mpsc::channel();
                let (release_tx, release_rx) = mpsc::channel();
                let release_rx = Mutex::new(release_rx);
                io_hooks().lock().unwrap().insert(
                    id.clone(),
                    Arc::new(move |op| {
                        if op == "remove" {
                            entered_tx.send(()).unwrap();
                            release_rx.lock().unwrap().recv().unwrap();
                        }
                    }),
                );
                let (worker_id, worker_path) = (id.clone(), path.clone());
                let worker = std::thread::spawn(move || {
                    confirm_at(&worker_id, elevated(), token, Ok(Some(worker_path)))
                });
                entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                // A newer denial lands while the confirmation is stalled on I/O.
                deny_in_memory(&id);
                if repair_fails {
                    inject(&path, |op, _| op == LedgerOp::Deny);
                }
                release_tx.send(()).unwrap();
                assert!(!worker.join().unwrap(), "stale token never acknowledges");
                io_hooks().lock().unwrap().remove(&id);
                clear_faults(&path);
                assert!(is_denied(&current(&id).0));
                if repair_fails {
                    assert!(denial_persisted(&id).is_err(), "failed repair is reported");
                    // The CONFIRM was flushed and nothing repaired it: reported, not hidden.
                    assert!(lines(&path).last().unwrap().contains("\"op\":\"confirm\""));
                    let retry = deny_in_memory(&id);
                    persist_denial_at(&id, retry, Ok(Some(path.clone())));
                }
                assert!(lines(&path).last().unwrap().contains("\"op\":\"deny\""));
                denial_persisted(&id).unwrap();
                assert!(is_denied(&restore(&id, &path, elevated())));
            }
        }

        #[test]
        fn restore_racing_a_denial_never_resurrects_a_confirm() {
            use std::sync::mpsc;
            use std::time::Duration;
            let d = dir();
            let (id, path) = ("ledger-restore-race", d.0.join("ledger-restore-race.ledger"));
            assert!(confirm(id, &path, elevated()));
            restart(id);
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let release_rx = Mutex::new(release_rx);
            io_hooks().lock().unwrap().insert(
                id.into(),
                Arc::new(move |op| {
                    if op == "restore" {
                        entered_tx.send(()).unwrap();
                        release_rx.lock().unwrap().recv().unwrap();
                    }
                }),
            );
            let worker_path = path.clone();
            let worker = std::thread::spawn(move || {
                restore_at(id, elevated(), Some(worker_path)).unwrap()
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            deny_in_memory(id);
            release_tx.send(()).unwrap();
            worker.join().unwrap();
            io_hooks().lock().unwrap().remove(id);
            assert!(is_denied(&current(id).0), "restore never overwrites a newer denial");
            persist_denial_at(id, 0, Ok(Some(path.clone())));
            assert!(is_denied(&restore(id, &path, elevated())));
        }

        #[test]
        fn ledger_stays_bounded() {
            let d = dir();
            let (id, path) = ("ledger-bounded", d.0.join("ledger-bounded.ledger"));
            for _ in 0..600 {
                assert!(confirm(id, &path, elevated()));
            }
            assert!(std::fs::metadata(&path).unwrap().len() < LEDGER_COMPACT_BYTES + 4096);
            assert!(!is_denied(&restore(id, &path, elevated())));
        }
    }

    /// Runs inside the durable-root test so global root configuration stays
    /// installed for the entire deterministic race (including repair writes).
    fn marker_races_keep_newer_denials() {
        use std::sync::mpsc;
        use std::time::Duration;
        for operation in ["remove", "restore", "write"] {
            let id = format!("durable-race-{operation}");
            let token = if operation == "restore" {
                0
            } else {
                narrow(&id)
            };
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let release_rx = Mutex::new(release_rx);
            io_hooks().lock().unwrap().insert(
                id.clone(),
                Arc::new(move |op| {
                    if op == operation {
                        entered_tx.send(()).unwrap();
                        release_rx.lock().unwrap().recv().unwrap();
                    }
                }),
            );
            let worker_id = id.clone();
            let worker = std::thread::spawn(move || match operation {
                "remove" => assert!(!confirm_if_current(&worker_id, elevated(), token)),
                "restore" => restore_if_absent(&worker_id, elevated()).unwrap(),
                _ => persist_denial(&worker_id, token),
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            // Both another identity and this identity remain responsive while
            // disk is stalled; denial does not wait for the I/O serialization.
            assert_eq!(generation("durable-race-other"), 0);
            let newer = deny_in_memory(&id);
            assert!(is_denied(&current(&id).0));
            assert_eq!(generation(&id), newer);
            // Stop/delete barriers must not lose pending denial persistence.
            bump_generation(&id);
            clear(&id);
            release_tx.send(()).unwrap();
            worker.join().unwrap();
            io_hooks().lock().unwrap().remove(&id);
            if operation == "remove" {
                assert!(
                    marker(&id).unwrap().unwrap().exists(),
                    "stale removal repairs before releasing I/O"
                );
            }
            if operation == "write" {
                denial_persisted(&id).expect("write also acknowledges a denial published during I/O");
            }
            persist_denial(&id, newer);
            denial_persisted(&id).unwrap();
            assert!(!confirm_if_current(&id, elevated(), token));
            assert!(is_denied(&current(&id).0));
            assert!(marker(&id).unwrap().unwrap().exists());
            confirmed().lock().unwrap().remove(&id);
            restore_if_absent(&id, elevated()).unwrap();
            assert!(
                is_denied(&current(&id).0),
                "restart must retain raced denial"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn durable_denials_block_restart_stale_fetch_corruption_and_reused_ids() {
        struct TestDirectory(PathBuf);
        impl Drop for TestDirectory {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let path = std::env::temp_dir().join(format!(
            "jan-consent-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
        assert!(
            is_denied(&current(id).0),
            "deleted/reused id cannot inherit disk consent"
        );
        let forged = "durable-unknown-zero";
        let forged_marker = marker(forged).unwrap().unwrap();
        std::fs::write(&forged_marker, b"deny").unwrap();
        assert!(!confirm_if_current(forged, elevated(), 0));
        assert!(
            forged_marker.exists(),
            "unknown zero token cannot erase a denial"
        );
        assert_eq!(generation(forged), 0);
        marker_races_keep_newer_denials();
        // Failed marker writes still deny in-process and surface durability failure.
        let bad = "durable-marker-failure";
        std::fs::create_dir(marker(bad).unwrap().unwrap()).unwrap();
        narrow(bad);
        assert!(denial_persisted(bad).is_err());
        restore_if_absent(bad, elevated()).unwrap();
        assert!(is_denied(&current(bad).0));
        clear(bad);
        assert!(
            denial_persisted(bad).is_err(),
            "delete cannot hide failed durable denial"
        );
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
        let stored_off = grant(false, Some(&absolute_fixture("stored")), "read");

        set_global_grants(GlobalGrants {
            shell_network: true,
            memory_write: true,
        });
        let on = stored_off.clone().with_global("persistent-chat");
        assert!(
            on.shell_network && on.memory_write,
            "defaults give Chat network and memory"
        );
        assert_eq!(
            on.folder_scope.as_ref().unwrap().path,
            absolute_fixture("stored")
        );

        set_global_grants(GlobalGrants {
            shell_network: false,
            memory_write: true,
        });
        let split = grant(true, None, "read").with_global("persistent-chat");
        assert!(!split.shell_network, "a global off beats a stored grant");
        assert!(split.memory_write, "fields are independent");

        // Global settings apply to host layers, never to a frozen effective
        // ceiling. A forged effective true cannot beat global false.
        let forged = grant(true, Some(&absolute_fixture("stored")), "write");
        let result = grant(false, Some(&absolute_fixture("stored")), "write")
            .with_global("persistent-chat")
            .intersect(forged.with_global("persistent-chat"))
            .unwrap();
        assert!(!result.shell_network && result.memory_write);
        assert_eq!(result.folder_scope.unwrap().access, "write");

        // The folder still needs the layers to agree.
        let result = grant(true, Some(&absolute_fixture("stored")), "write")
            .with_global("persistent-chat")
            .intersect(grant(true, None, "read").with_global("persistent-chat"))
            .unwrap();
        assert!(result.folder_scope.is_none());

        set_global_grants(GlobalGrants::default());
        for ceiling in [denied(), grant(false, Some(&absolute_fixture("stored")), "write")] {
            let result = grant(true, Some(&absolute_fixture("stored")), "write")
                .with_global("persistent-chat")
                .intersect(ceiling)
                .unwrap()
                .intersect(denied().with_global("persistent-chat"))
                .unwrap();
            assert!(
                !result.shell_network && !result.memory_write,
                "frozen false ceilings cannot be widened by global ON"
            );
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
            .intersect(grant(true, Some(&absolute_fixture("stored")), "write"))
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

    // ---- legacy (no host record) binding: never folder authority --------------

    #[tokio::test]
    async fn bind_legacy_session_never_authorizes_a_folder_for_any_kind() {
        let folder = absolute_fixture("bind-legacy");
        for (id, kind, scratch_ok) in [
            ("bl-cowork", ThreadKind::Cowork, true),
            ("bl-legacy", ThreadKind::LegacyCowork, true),
            ("bl-chat", ThreadKind::Chat, false),
            ("bl-unknown", ThreadKind::Unknown, false),
        ] {
            test_set_kind(id, kind);
            // A renderer-recorded folder (metadata.folder / code-sessions) is
            // not authority: even a positively identified Cowork id is refused.
            for w in [Some(true), Some(false), None] {
                assert!(bind_legacy_session(id, Some(&folder), w).await.is_err(), "{id} {w:?}");
            }
            assert_eq!(bind_legacy_session(id, None, Some(true)).await.is_ok(), scratch_ok, "{id} scratch");
        }
        // Scratch-only never carries write.
        test_set_kind("bl-scratch", ThreadKind::Cowork);
        assert_eq!(bind_legacy_session("bl-scratch", None, Some(true)).await.unwrap(), (None, Some(false)));
        assert_eq!(bind_legacy_session("bl-scratch", None, None).await.unwrap(), (None, None));
        // Nothing installed for this id: fail closed.
        assert!(bind_legacy_session("bl-nothing", Some(&folder), Some(true)).await.is_err());
        assert!(bind_legacy_session("bl-nothing", None, None).await.is_err());
    }
}
