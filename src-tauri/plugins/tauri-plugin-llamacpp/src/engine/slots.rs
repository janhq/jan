//! Persistence of a thread's KV cache across sessions.
//!
//! llama.cpp can already write a slot's KV cache to disk
//! (`POST /slots/{id}?action=save`, `server-context.cpp:2475`), but the file it
//! writes carries no identity: `llama_state_seq_load_file` checks a magic and a
//! version, and the restore path checks that the tokens fit the context and are
//! in the vocab. None of that notices that the file was written by a *different
//! model*, or by a build whose KV layout has since changed -- both of which
//! restore as plausible-looking nonsense rather than an error.
//!
//! So every state file gets a sidecar recording what produced it, and a restore
//! that disagrees is refused and deleted rather than fed to llama.cpp. The
//! guard is deliberately broader than "same model": `spec` is the model's whole
//! preset section, so a changed `ctx-size`, `cache-type-k`, `flash-attn` or
//! `parallel` invalidates the state too, since each of those changes what the
//! cache means.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Files below this many tokens are not worth their write: the prefill they
/// save is shorter than the disk round trip that restores them.
pub const MIN_TOKENS_TO_SAVE: u64 = 256;

/// Sidecar suffix. The state file itself is `<key>.bin`, which is what
/// llama.cpp is handed; `fs_validate_filename` accepts it because the key is
/// hex.
const STATE_EXT: &str = "bin";
const META_EXT: &str = "json";

/// What produced a state file. Every field is part of the restore guard except
/// `n_tokens` and `saved_at`, which are reporting and pruning respectively.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateMeta {
    /// The model id the state was captured under.
    pub model: String,
    /// The thread the state belongs to. Not part of the guard -- the file name
    /// already encodes it -- but recorded so a thread's state can be erased
    /// without the caller knowing which model produced it, which is exactly the
    /// position the UI is in when a thread is deleted.
    #[serde(default)]
    pub thread: String,
    /// Fingerprint of the model's preset section, so a settings change that
    /// alters the cache layout invalidates the state.
    pub spec: String,
    /// llama.cpp build the state was written by. The KV serialization format is
    /// versioned, but the *contents* are not: a build that changes cache layout
    /// without bumping the version restores silently corrupt state.
    pub llama_build: String,
    pub llama_commit: String,
    /// Size and mtime of the gguf, so replacing a model file in place (a
    /// re-download, a quant swap) is caught even though the path is unchanged.
    pub model_bytes: u64,
    pub model_mtime: u64,
    pub n_tokens: u64,
    pub saved_at: u64,
}

/// Why a state file cannot be used. Every arm is a reason to delete the file:
/// none of them can become valid again for the request that just asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reject {
    /// Nothing was ever saved for this key.
    Absent,
    /// The sidecar is missing or unreadable, so the file's provenance is
    /// unknown. Treated as a mismatch rather than trusted.
    NoMeta,
    ModelChanged {
        saved: String,
        wanted: String,
    },
    SettingsChanged,
    LlamaChanged {
        saved: String,
        wanted: String,
    },
    ModelFileChanged,
}

impl std::fmt::Display for Reject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Absent => write!(f, "no saved state"),
            Self::NoMeta => write!(f, "saved state has no sidecar, so its origin is unknown"),
            Self::ModelChanged { saved, wanted } => {
                write!(f, "saved state is for model {saved}, not {wanted}")
            }
            Self::SettingsChanged => {
                write!(
                    f,
                    "the model's load settings changed since the state was saved"
                )
            }
            Self::LlamaChanged { saved, wanted } => {
                write!(
                    f,
                    "saved state is from llama.cpp {saved}, this build is {wanted}"
                )
            }
            Self::ModelFileChanged => write!(f, "the model file changed since the state was saved"),
        }
    }
}

/// The identity a restore is checked against. Built once per request from the
/// registry, so the comparison cannot drift from what was actually loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub model: String,
    pub spec: String,
    pub llama_build: String,
    pub llama_commit: String,
    pub model_bytes: u64,
    pub model_mtime: u64,
}

impl Identity {
    /// `spec_body` is the model's preset section (shared `[*]` block included),
    /// which `LoadSpec::Preset` already carries and keeps sorted.
    pub fn new(model: &str, spec_body: &[String], model_path: Option<&Path>) -> Self {
        let (model_bytes, model_mtime) = model_path.map(file_stamp).unwrap_or((0, 0));
        Self {
            model: model.to_string(),
            spec: fingerprint(spec_body),
            llama_build: super::PINNED_BUILD_NUMBER.to_string(),
            llama_commit: super::PINNED_COMMIT.to_string(),
            model_bytes,
            model_mtime,
        }
    }

    fn into_meta(self, thread: &str, n_tokens: u64) -> StateMeta {
        StateMeta {
            model: self.model,
            thread: thread.to_string(),
            spec: self.spec,
            llama_build: self.llama_build,
            llama_commit: self.llama_commit,
            model_bytes: self.model_bytes,
            model_mtime: self.model_mtime,
            n_tokens,
            saved_at: now_secs(),
        }
    }

    /// The whole condition, in one place: same model, same load settings, same
    /// llama.cpp, same model file.
    pub fn accepts(&self, meta: &StateMeta) -> Result<(), Reject> {
        if meta.model != self.model {
            return Err(Reject::ModelChanged {
                saved: meta.model.clone(),
                wanted: self.model.clone(),
            });
        }
        if meta.llama_build != self.llama_build || meta.llama_commit != self.llama_commit {
            return Err(Reject::LlamaChanged {
                saved: format!("{} ({})", meta.llama_build, short(&meta.llama_commit)),
                wanted: format!("{} ({})", self.llama_build, short(&self.llama_commit)),
            });
        }
        if meta.spec != self.spec {
            return Err(Reject::SettingsChanged);
        }
        // A stamp of 0 means the path was not known at save or at restore, so
        // there is nothing to compare rather than a mismatch to report.
        let stamped = meta.model_bytes != 0 && self.model_bytes != 0;
        if stamped && (meta.model_bytes != self.model_bytes || meta.model_mtime != self.model_mtime)
        {
            return Err(Reject::ModelFileChanged);
        }
        Ok(())
    }
}

fn short(commit: &str) -> &str {
    &commit[..commit.len().min(8)]
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_stamp(path: &Path) -> (u64, u64) {
    match std::fs::metadata(path) {
        Ok(m) => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (m.len(), mtime)
        }
        Err(_) => (0, 0),
    }
}

fn fingerprint(lines: &[String]) -> String {
    let mut h = Sha256::new();
    for l in lines {
        h.update(l.as_bytes());
        h.update([0u8]);
    }
    hex16(&h.finalize())
}

/// The file name for one (model, thread) pair.
///
/// Hashed rather than composed from the ids: a thread id is a uuid and a model
/// id is user-facing text that can hold path separators, spaces and non-ascii,
/// none of which `fs_validate_filename` accepts. Hex is also what keeps the
/// name inside the 255-byte limit that same function enforces.
pub fn state_key(model: &str, thread: &str) -> String {
    let mut h = Sha256::new();
    h.update(model.as_bytes());
    h.update([0u8]);
    h.update(thread.as_bytes());
    hex16(&h.finalize())
}

fn hex16(digest: &[u8]) -> String {
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// The directory of saved states, and the operations over it.
///
/// The same directory llama.cpp was given as `--slot-save-path`: it joins the
/// file name onto that prefix itself, so both sides must agree on it and only
/// the *name* crosses the boundary.
#[derive(Debug)]
pub struct StateStore {
    dir: PathBuf,
    /// Total bytes of state files to keep. Pruning is LRU by save time, so the
    /// thread the user is actually working in is the last to go.
    ///
    /// Atomic because the user can lower it mid-session and a limit that only
    /// took effect at the next launch would leave the disk they were trying to
    /// reclaim occupied until then.
    budget_bytes: std::sync::atomic::AtomicU64,
}

impl StateStore {
    pub fn new(dir: impl Into<PathBuf>, budget_mib: u64) -> Self {
        Self {
            dir: dir.into(),
            budget_bytes: std::sync::atomic::AtomicU64::new(budget_mib.saturating_mul(1024 * 1024)),
        }
    }

    fn budget(&self) -> u64 {
        self.budget_bytes.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Applies a new budget and reclaims down to it at once. Returns the keys
    /// dropped.
    pub fn set_budget_mib(&self, budget_mib: u64) -> Vec<String> {
        self.budget_bytes.store(
            budget_mib.saturating_mul(1024 * 1024),
            std::sync::atomic::Ordering::Relaxed,
        );
        self.prune()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Creates the directory. llama.cpp's `--slot-save-path` handler *throws*
    /// when the path is not a directory (`common/arg.cpp:3580`), and that
    /// unwinds out of engine startup, so a missing cache directory would take
    /// the whole engine down rather than disabling one feature.
    pub fn ensure_dir(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)
    }

    fn state_path(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.{STATE_EXT}"))
    }

    fn meta_path(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.{META_EXT}"))
    }

    /// The name to hand llama.cpp, which resolves it against the same
    /// directory.
    pub fn state_file_name(key: &str) -> String {
        format!("{key}.{STATE_EXT}")
    }

    /// Whether a restore may proceed, and why not when it may not.
    ///
    /// A rejected file is deleted here: keeping it would re-run the same
    /// comparison on every later turn of a thread that can never use it.
    pub fn check(&self, key: &str, want: &Identity) -> Result<StateMeta, Reject> {
        if !self.state_path(key).is_file() {
            // A sidecar with no state file is debris from a failed save.
            let _ = std::fs::remove_file(self.meta_path(key));
            return Err(Reject::Absent);
        }
        let Some(meta) = self.read_meta(key) else {
            self.forget(key);
            return Err(Reject::NoMeta);
        };
        match want.accepts(&meta) {
            Ok(()) => Ok(meta),
            Err(e) => {
                self.forget(key);
                Err(e)
            }
        }
    }

    fn read_meta(&self, key: &str) -> Option<StateMeta> {
        let raw = std::fs::read_to_string(self.meta_path(key)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// Records what a just-written state file contains. Called *after*
    /// llama.cpp wrote the `.bin`, so a crash between the two leaves an
    /// orphaned state file, which `check` treats as `NoMeta` and removes.
    pub fn commit(
        &self,
        key: &str,
        want: Identity,
        thread: &str,
        n_tokens: u64,
    ) -> std::io::Result<()> {
        let meta = want.into_meta(thread, n_tokens);
        let json = serde_json::to_string(&meta).map_err(std::io::Error::other)?;
        write_atomic(&self.meta_path(key), json.as_bytes())?;
        self.prune();
        Ok(())
    }

    /// Drops both files for a key. Used on a rejected restore and on thread
    /// deletion.
    pub fn forget(&self, key: &str) {
        let _ = std::fs::remove_file(self.state_path(key));
        let _ = std::fs::remove_file(self.meta_path(key));
    }

    /// Every saved key with its size and save time, oldest first.
    fn entries(&self) -> Vec<(String, u64, u64)> {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return out;
        };
        for e in rd.flatten() {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some(STATE_EXT) {
                continue;
            }
            let Some(key) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
            // Fall back to the file's own mtime when the sidecar is gone, so an
            // orphan still takes part in pruning instead of being immortal.
            let saved_at = self
                .read_meta(key)
                .map(|m| m.saved_at)
                .unwrap_or_else(|| file_stamp(&path).1);
            out.push((key.to_string(), bytes, saved_at));
        }
        out.sort_by_key(|(_, _, saved_at)| *saved_at);
        out
    }

    pub fn total_bytes(&self) -> u64 {
        self.entries().iter().map(|(_, b, _)| *b).sum()
    }

    /// Deletes oldest-first until the directory fits the budget. A single state
    /// file can be hundreds of MiB, so an unbounded directory is the difference
    /// between a cache and a disk leak.
    pub fn prune(&self) -> Vec<String> {
        let entries = self.entries();
        let mut total: u64 = entries.iter().map(|(_, b, _)| *b).sum();
        let mut dropped = Vec::new();
        for (key, bytes, _) in entries {
            if total <= self.budget() {
                break;
            }
            self.forget(&key);
            total = total.saturating_sub(bytes);
            dropped.push(key);
        }
        dropped
    }

    /// Drops every state for a model, for an unload that changed its settings.
    pub fn forget_model(&self, model: &str) -> usize {
        self.forget_where(|m| m.model == model)
    }

    /// Drops a thread's state whichever model produced it. A thread the user
    /// deleted may have been talked to under several models, and the caller
    /// knows the thread id and nothing else.
    pub fn forget_thread(&self, thread: &str) -> usize {
        self.forget_where(|m| m.thread == thread)
    }

    fn forget_where(&self, pred: impl Fn(&StateMeta) -> bool) -> usize {
        let mut n = 0;
        for (key, _, _) in self.entries() {
            if self.read_meta(&key).is_some_and(|m| pred(&m)) {
                self.forget(&key);
                n += 1;
            }
        }
        n
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Which thread's state each slot is holding, per model.
///
/// The worker needs this because a save has to name a slot, and only the worker
/// knows which thread last ran there. Chat is pinned to slot 0 by the frontend
/// (`custom-chat-transport.ts`), so in practice this is one entry per model,
/// but nothing here assumes that.
#[derive(Debug, Default)]
pub struct SlotOccupancy {
    resident: HashMap<(String, i32), String>,
}

/// What claiming a slot did, which decides what has to happen to disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    /// The thread was already in this slot. Nothing to do: the live cache is
    /// newer than anything on disk, so restoring over it would *lose* the
    /// last turn's prefill rather than save any.
    Unchanged,
    /// Nobody was in the slot -- a fresh worker. This is the cross-session
    /// case: restore, but there is nothing to park.
    Empty,
    /// Another thread was in the slot. Its cache has to reach disk before the
    /// restore overwrites it.
    Evicted(String),
}

impl SlotOccupancy {
    /// Records that `thread` now owns `slot` of `model`.
    pub fn claim(&mut self, model: &str, slot: i32, thread: &str) -> Claim {
        let prev = self
            .resident
            .insert((model.to_string(), slot), thread.to_string());
        match prev {
            None => Claim::Empty,
            Some(p) if p == thread => Claim::Unchanged,
            Some(p) => Claim::Evicted(p),
        }
    }

    pub fn get(&self, model: &str, slot: i32) -> Option<&str> {
        self.resident
            .get(&(model.to_string(), slot))
            .map(|s| s.as_str())
    }

    /// Everything resident, for the save-everything pass at shutdown.
    pub fn all(&self) -> Vec<(String, i32, String)> {
        let mut v: Vec<_> = self
            .resident
            .iter()
            .map(|((m, s), t)| (m.clone(), *s, t.clone()))
            .collect();
        v.sort();
        v
    }

    pub fn release_model(&mut self, model: &str) {
        self.resident.retain(|(m, _), _| m != model);
    }

    /// Forgets a thread wherever it is sitting. Without this an erase would
    /// leave the slot still claimed by a deleted thread, and the next thread to
    /// take it would save that dead id's state right back to disk.
    pub fn release_thread(&mut self, thread: &str) {
        self.resident.retain(|_, t| t != thread);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "jan-slots-test-{tag}-{}-{}",
            std::process::id(),
            now_secs()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn ident(model: &str, spec: &[&str]) -> Identity {
        let body: Vec<String> = spec.iter().map(|s| s.to_string()).collect();
        Identity::new(model, &body, None)
    }

    fn store(tag: &str) -> StateStore {
        StateStore::new(tmpdir(tag), 1024)
    }

    fn plant(s: &StateStore, key: &str, bytes: usize) {
        std::fs::write(s.state_path(key), vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn a_key_is_stable_and_separates_models_and_threads() {
        assert_eq!(state_key("m", "t"), state_key("m", "t"));
        assert_ne!(state_key("m", "t"), state_key("m", "t2"));
        assert_ne!(state_key("m", "t"), state_key("m2", "t"));
        // The name has to survive llama.cpp's fs_validate_filename, which
        // rejects separators and anything non-printable.
        let k = state_key("Qwen3/0.6B IQ4_XS", "0f9a-uuid");
        assert_eq!(k.len(), 32);
        assert!(k.chars().all(|c| c.is_ascii_hexdigit()), "{k}");
    }

    #[test]
    fn an_absent_state_is_reported_rather_than_restored() {
        let s = store("absent");
        assert_eq!(
            s.check("deadbeef", &ident("m", &["a"])),
            Err(Reject::Absent)
        );
    }

    #[test]
    fn a_matching_state_is_accepted() {
        let s = store("match");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        s.commit(&key, ident("m", &["ctx-size = 4096"]), "t", 900)
            .unwrap();
        let meta = s
            .check(&key, &ident("m", &["ctx-size = 4096"]))
            .expect("same model, same settings, same build");
        assert_eq!(meta.n_tokens, 900);
    }

    #[test]
    fn a_different_model_is_refused_and_the_file_dropped() {
        let s = store("model");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        s.commit(&key, ident("m", &["a"]), "t", 900).unwrap();
        let err = s.check(&key, &ident("other", &["a"])).unwrap_err();
        assert!(matches!(err, Reject::ModelChanged { .. }), "{err:?}");
        assert!(
            !s.state_path(&key).exists(),
            "a state that can never match again must not be kept"
        );
    }

    #[test]
    fn a_changed_setting_invalidates_the_state() {
        let s = store("spec");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        s.commit(&key, ident("m", &["ctx-size = 4096"]), "t", 900)
            .unwrap();
        assert_eq!(
            s.check(&key, &ident("m", &["ctx-size = 8192"]))
                .unwrap_err(),
            Reject::SettingsChanged
        );
    }

    #[test]
    fn a_different_llama_build_is_refused() {
        let s = store("build");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        let mut stale = ident("m", &["a"]);
        stale.llama_build = "1".to_string();
        stale.llama_commit = "0000000000".to_string();
        s.commit(&key, stale, "t", 900).unwrap();
        let err = s.check(&key, &ident("m", &["a"])).unwrap_err();
        assert!(matches!(err, Reject::LlamaChanged { .. }), "{err:?}");
    }

    #[test]
    fn a_replaced_model_file_is_refused_even_at_the_same_path() {
        let s = store("gguf");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        let mut before = ident("m", &["a"]);
        before.model_bytes = 4096;
        before.model_mtime = 111;
        s.commit(&key, before, "t", 900).unwrap();
        let mut after = ident("m", &["a"]);
        after.model_bytes = 8192;
        after.model_mtime = 222;
        assert_eq!(s.check(&key, &after).unwrap_err(), Reject::ModelFileChanged);
    }

    // A path that neither side could stat is not evidence of a change.
    #[test]
    fn an_unstamped_model_file_is_not_treated_as_a_mismatch() {
        let s = store("unstamped");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        s.commit(&key, ident("m", &["a"]), "t", 900).unwrap();
        let mut wanted = ident("m", &["a"]);
        wanted.model_bytes = 0;
        assert!(s.check(&key, &wanted).is_ok());
    }

    #[test]
    fn a_state_file_without_a_sidecar_is_refused_not_trusted() {
        let s = store("orphan");
        let key = state_key("m", "t");
        plant(&s, &key, 8);
        assert_eq!(
            s.check(&key, &ident("m", &["a"])).unwrap_err(),
            Reject::NoMeta
        );
        assert!(!s.state_path(&key).exists());
    }

    #[test]
    fn a_sidecar_without_a_state_file_is_swept() {
        let s = store("halfsave");
        let key = state_key("m", "t");
        s.commit(&key, ident("m", &["a"]), "t", 900).unwrap();
        assert_eq!(
            s.check(&key, &ident("m", &["a"])).unwrap_err(),
            Reject::Absent
        );
        assert!(!s.meta_path(&key).exists(), "debris must not accumulate");
    }

    /// Plants a state file and its sidecar without going through `commit`,
    /// which prunes as it writes -- the point here is to control `saved_at`,
    /// whose one-second resolution cannot order four writes in a loop.
    fn plant_aged(s: &StateStore, key: &str, bytes: usize, saved_at: u64) {
        plant(s, key, bytes);
        let mut meta = ident("m", &["a"]).into_meta("t", 900);
        meta.saved_at = saved_at;
        std::fs::write(s.meta_path(key), serde_json::to_string(&meta).unwrap()).unwrap();
    }

    #[test]
    fn pruning_drops_the_oldest_until_the_budget_fits() {
        // 3 MiB of budget, four 1 MiB states.
        let s = StateStore::new(tmpdir("prune"), 3);
        for i in 0..4 {
            plant_aged(
                &s,
                &state_key("m", &format!("t{i}")),
                1024 * 1024,
                1000 + i as u64,
            );
        }
        let dropped = s.prune();
        assert_eq!(dropped, vec![state_key("m", "t0")], "oldest first");
        assert!(s.total_bytes() <= 3 * 1024 * 1024);
        assert!(s.state_path(&state_key("m", "t3")).exists(), "newest kept");
    }

    // A write that alone blows the budget is pruned rather than left to grow
    // the directory past it -- and it is the last candidate, not the first,
    // because it is the newest.
    #[test]
    fn a_single_oversized_state_does_not_escape_the_budget() {
        let s = StateStore::new(tmpdir("oversize"), 1);
        let key = state_key("m", "t");
        plant(&s, &key, 4 * 1024 * 1024);
        s.commit(&key, ident("m", &["a"]), "t", 900).unwrap();
        assert!(s.total_bytes() <= 1024 * 1024);
        assert!(!s.state_path(&key).exists());
    }

    #[test]
    fn forget_model_clears_only_that_models_states() {
        let s = store("forget");
        for (model, thread) in [("a", "t1"), ("a", "t2"), ("b", "t1")] {
            let key = state_key(model, thread);
            plant(&s, &key, 8);
            s.commit(&key, ident(model, &["x"]), thread, 900).unwrap();
        }
        assert_eq!(s.forget_model("a"), 2);
        assert!(s.state_path(&state_key("b", "t1")).exists());
    }

    // A thread the user deletes has to be erasable without the caller knowing
    // which model produced its state, since the UI does not track that.
    #[test]
    fn forget_thread_clears_that_thread_under_every_model() {
        let s = store("forget-thread");
        for (model, thread) in [("a", "t1"), ("b", "t1"), ("a", "t2")] {
            let key = state_key(model, thread);
            plant(&s, &key, 8);
            s.commit(&key, ident(model, &["x"]), thread, 900).unwrap();
        }
        assert_eq!(s.forget_thread("t1"), 2);
        assert!(s.state_path(&state_key("a", "t2")).exists());
    }

    // A sidecar written before `thread` existed has no thread to match, and
    // must not be treated as belonging to every thread.
    #[test]
    fn a_sidecar_with_no_thread_field_is_not_matched_by_forget_thread() {
        let s = store("legacy-meta");
        let key = state_key("m", "t1");
        plant(&s, &key, 8);
        let mut meta = ident("m", &["x"]).into_meta("t1", 900);
        meta.thread = String::new();
        std::fs::write(s.meta_path(&key), serde_json::to_string(&meta).unwrap()).unwrap();
        assert_eq!(s.forget_thread("t1"), 0);
        assert_eq!(s.forget_model("m"), 1, "the model is still recorded");
    }

    #[test]
    fn releasing_a_thread_frees_the_slot_it_was_sitting_in() {
        let mut occ = SlotOccupancy::default();
        occ.claim("m", 0, "t1");
        occ.claim("m2", 1, "t1");
        occ.release_thread("t1");
        // Left claimed, the next thread in that slot would save the deleted
        // thread's state straight back to disk.
        assert!(occ.all().is_empty());
    }

    #[test]
    fn the_state_file_name_is_what_llama_cpp_is_handed() {
        assert_eq!(StateStore::state_file_name("ab12"), "ab12.bin");
    }

    #[test]
    fn claiming_a_slot_distinguishes_empty_from_evicted() {
        let mut occ = SlotOccupancy::default();
        assert_eq!(occ.claim("m", 0, "t1"), Claim::Empty);
        assert_eq!(occ.claim("m", 0, "t2"), Claim::Evicted("t1".to_string()));
        assert_eq!(occ.get("m", 0), Some("t2"));
    }

    // The distinction that matters most: turn 2 of a thread must not restore
    // over its own live cache, which is newer than anything on disk. Reporting
    // this as an eviction would cost a full prefill on every turn.
    #[test]
    fn a_second_turn_in_the_same_thread_is_unchanged_not_a_handover() {
        let mut occ = SlotOccupancy::default();
        occ.claim("m", 0, "t1");
        assert_eq!(occ.claim("m", 0, "t1"), Claim::Unchanged);
        assert_eq!(occ.claim("m", 0, "t1"), Claim::Unchanged);
    }

    #[test]
    fn occupancy_is_per_model_and_per_slot() {
        let mut occ = SlotOccupancy::default();
        occ.claim("m1", 0, "t1");
        occ.claim("m2", 0, "t2");
        occ.claim("m1", 1, "t3");
        assert_eq!(occ.get("m1", 0), Some("t1"));
        assert_eq!(
            occ.all(),
            vec![
                ("m1".to_string(), 0, "t1".to_string()),
                ("m1".to_string(), 1, "t3".to_string()),
                ("m2".to_string(), 0, "t2".to_string()),
            ]
        );
        occ.release_model("m1");
        assert_eq!(occ.get("m1", 0), None);
        assert_eq!(occ.get("m2", 0), Some("t2"));
    }
}
