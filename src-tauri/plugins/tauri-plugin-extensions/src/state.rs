//! The plugin's state: the extensions root, the registry lock, staged
//! installs awaiting consent, and the network client extensions use.
//! Constructible without a Tauri runtime, so the install pipeline is tested
//! against a temporary root.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::oneshot;

use crate::error::{Error, Result};
use crate::manifest::ValidatedManifest;
use crate::registry::{self, Registry, Source};
use crate::store::random_id;

/// Directory under the root that holds extractions awaiting consent.
pub const STAGING_DIR: &str = ".staging";
/// Environment variable that forces safe mode on when set to `1`.
pub const SAFE_MODE_ENV: &str = "JAN_EXTENSIONS_SAFE_MODE";
/// Staged installs kept at once; each holds an extracted package on disk.
pub const MAX_STAGES: usize = 8;

/// A package extracted to `.staging/<id>` and awaiting `confirm_install`.
#[derive(Debug, Clone)]
pub struct Stage {
    /// The stage id, also the directory name.
    pub id: String,
    /// The extracted package.
    pub dir: PathBuf,
    /// Its validated manifest.
    pub manifest: ValidatedManifest,
    /// SRI of the tarball.
    pub sha512: String,
    /// Where the tarball came from.
    pub source: Source,
    /// Whether the tarball matched a pinned SRI.
    pub integrity_checked: bool,
    /// SRI of the entry file.
    pub entry_sha512: String,
}

/// How the state is set up.
#[derive(Debug, Clone)]
pub struct Options {
    /// This Jan's version, checked against `engines.jan`.
    pub app_version: String,
    /// Safe mode forced on for this run, whatever the registry says.
    pub safe_mode_forced: bool,
}

/// Everything the commands share.
pub struct ExtensionsState {
    pub(crate) root: PathBuf,
    pub(crate) options: Options,
    /// Serializes every read-modify-write of `extensions.json` and the
    /// directory moves that go with it.
    pub(crate) lock: Mutex<()>,
    /// Staged installs by id; `None` is a slot reserved by a [`StageSlot`]
    /// whose package is still being downloaded or extracted.
    pub(crate) stages: Arc<Mutex<HashMap<String, Option<Stage>>>>,
    /// The registry as last read or written, for the async network path,
    /// which must not do file I/O on the runtime. `None` until a read
    /// succeeds.
    registry_cache: Mutex<Option<Registry>>,
    pub(crate) recovered_from: Mutex<Option<PathBuf>>,
    pub(crate) local_api_port: Mutex<Option<u16>>,
    /// Extension traffic: no cookie store, no redirects followed.
    pub(crate) http: reqwest::Client,
    /// Index and tarball downloads: no cookie store, https redirects only.
    pub(crate) index_http: reqwest::Client,
    /// Serializes changes to `sources.json`.
    pub(crate) sources_lock: Mutex<()>,
    pub(crate) requests: Mutex<HashMap<String, Running>>,
    next_token: AtomicU64,
}

/// An in-flight extension request, keyed by `<id>\n<request id>`.
pub(crate) struct Running {
    /// Unique per registration, so a finished request only ever removes
    /// its own entry.
    pub(crate) token: u64,
    /// Taken by the first cancel.
    pub(crate) cancel: Option<oneshot::Sender<()>>,
}

/// Locks `m`, recovering the data if a panicking holder poisoned it: every
/// guarded value here is valid between statements.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether `JAN_EXTENSIONS_SAFE_MODE=1` is set.
pub fn safe_mode_from_env() -> bool {
    std::env::var(SAFE_MODE_ENV).is_ok_and(|v| v == "1")
}

/// The client behind `http_fetch`. Built without the `cookies` feature and
/// without a cookie store, so no request carries or keeps the app's
/// cookies, and with redirects off so every hop goes back to the caller to
/// be checked against the grants.
pub(crate) fn extension_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Network(format!("cannot create the HTTP client: {e}")))
}

impl ExtensionsState {
    /// Sets up the state over `root`: wipes `.staging` (a stage never
    /// survives a restart) and reads the registry once, so a corrupt file is
    /// moved aside and reported now rather than on first use.
    pub fn new(root: impl Into<PathBuf>, options: Options) -> Result<Self> {
        let root = root.into();
        let staging = root.join(STAGING_DIR);
        if let Err(e) = fs::remove_dir_all(&staging) {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("cannot clear {}: {e}", staging.display());
            }
        }
        let state = ExtensionsState {
            root,
            options,
            lock: Mutex::new(()),
            stages: Arc::new(Mutex::new(HashMap::new())),
            registry_cache: Mutex::new(None),
            recovered_from: Mutex::new(None),
            local_api_port: Mutex::new(None),
            http: extension_client()?,
            index_http: crate::index::client()?,
            sources_lock: Mutex::new(()),
            requests: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(0),
        };
        {
            let _guard = lock(&state.lock);
            if let Err(e) = state.load_registry() {
                log::error!("cannot read the extensions registry: {e}");
            }
        }
        Ok(state)
    }

    /// The extensions root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Records the port Jan's local API server listens on, or `None` when it
    /// stops. No extension request reaches it on a local host.
    pub fn set_local_api_port(&self, port: Option<u16>) {
        *lock(&self.local_api_port) = port;
    }

    pub(crate) fn local_api_port(&self) -> Option<u16> {
        *lock(&self.local_api_port)
    }

    pub(crate) fn next_request_token(&self) -> u64 {
        self.next_token.fetch_add(1, Ordering::Relaxed)
    }

    /// Reads the registry; the caller holds `self.lock`.
    pub(crate) fn load_registry(&self) -> Result<Registry> {
        let loaded = registry::load(&self.root)?;
        if let Some(path) = loaded.recovered_from {
            *lock(&self.recovered_from) = Some(path);
        }
        *lock(&self.registry_cache) = Some(loaded.registry.clone());
        Ok(loaded.registry)
    }

    /// Writes the registry; the caller holds `self.lock`.
    pub(crate) fn save_registry(&self, registry: &Registry) -> Result<()> {
        registry::save(&self.root, registry)?;
        *lock(&self.registry_cache) = Some(registry.clone());
        Ok(())
    }

    /// The registry as last read or written, without touching the disk.
    /// Every change goes through [`Self::save_registry`], so a revoke is
    /// seen by the next request.
    pub(crate) fn cached_registry(&self) -> Option<Registry> {
        lock(&self.registry_cache).clone()
    }

    /// Whether installed extensions are kept from running.
    pub(crate) fn safe_mode(&self, registry: &Registry) -> bool {
        self.options.safe_mode_forced || registry.safe_mode
    }
}

/// A place among the [`MAX_STAGES`] staged installs, taken before any
/// download or extraction so concurrent stagings cannot pass the limit.
/// Dropped unfilled, it frees the place again.
pub struct StageSlot {
    stages: Arc<Mutex<HashMap<String, Option<Stage>>>>,
    id: String,
    filled: bool,
}

impl StageSlot {
    /// Reserves a slot, or fails when [`MAX_STAGES`] stages are pending or
    /// being prepared.
    pub fn reserve(state: &ExtensionsState) -> Result<StageSlot> {
        let mut stages = lock(&state.stages);
        if stages.len() >= MAX_STAGES {
            return Err(Error::Denied(
                "too many installs are waiting for confirmation; finish or cancel one first".into(),
            ));
        }
        let id = random_id();
        stages.insert(id.clone(), None);
        Ok(StageSlot {
            stages: Arc::clone(&state.stages),
            id,
            filled: false,
        })
    }

    /// The id the stage will have.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Turns the slot into the stage `stage`, whose `id` must be [`Self::id`].
    pub(crate) fn fill(mut self, stage: Stage) {
        lock(&self.stages).insert(self.id.clone(), Some(stage));
        self.filled = true;
    }
}

impl Drop for StageSlot {
    fn drop(&mut self) {
        if !self.filled {
            lock(&self.stages).remove(&self.id);
        }
    }
}
