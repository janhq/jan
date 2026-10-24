//! Index sources and catalog operations over an [`ExtensionsState`]: the
//! command bodies of `list_sources`, `add_source`, `remove_source`,
//! `get_catalog`, `stage_from_index` and `accept_next_key`.
//!
//! Every index read from a source with a pinned key is signature-checked
//! (see [`index::fetch_index`]); a failure rejects the catalog and any
//! install from it before the index is parsed. A signed index must also be
//! fresh (see [`accept_index`]): not older than the newest one accepted
//! from the source and not past its `expires`.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::index::{self, CuratedIndex, FetchedIndex};
use crate::install::{self, StagedInstall};
use crate::sources::{self, IndexSourceEntry, RemovedPin, Sources, SourcesNotice};
use crate::state::{lock, ExtensionsState, StageSlot};
use crate::store::unix_now;

/// The sources as `list_sources` returns them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceList {
    /// Every source the user added.
    pub sources: Vec<IndexSourceEntry>,
    /// Keys of keyed sources the user removed, so the UI can warn when one
    /// of their URLs is added again without a key.
    pub removed_pins: Vec<RemovedPin>,
    /// Set when `sources.json` had to be repaired this session.
    pub notice: Option<SourcesNotice>,
}

/// Loads the store, keeping any repair notice for [`list_sources`]. The
/// caller holds `sources_lock`.
fn load_store(state: &ExtensionsState) -> Result<Sources> {
    let (store, notice) = sources::load_reporting(state.root())?;
    if notice.is_some() {
        *lock(&state.sources_notice) = notice;
    }
    Ok(store)
}

/// Every source the user added, the removed pins, and what a repair of the
/// store dropped, if anything.
pub fn list_sources(state: &ExtensionsState) -> Result<SourceList> {
    let _guard = lock(&state.sources_lock);
    let store = load_store(state)?;
    Ok(SourceList {
        sources: store.sources,
        removed_pins: store.removed_pins,
        notice: lock(&state.sources_notice).clone(),
    })
}

/// Adds an https index source, pinning `public_key` if given.
pub fn add_source(
    state: &ExtensionsState,
    url: &str,
    name: &str,
    public_key: Option<&str>,
) -> Result<IndexSourceEntry> {
    let _guard = lock(&state.sources_lock);
    let mut store = load_store(state)?;
    let entry = store.add(url, name, public_key)?;
    sources::save(state.root(), &store)?;
    Ok(entry)
}

/// Removes a source. Extensions installed from it stay installed; the key
/// of a keyed source is remembered as a removed pin.
pub fn remove_source(state: &ExtensionsState, id: &str) -> Result<()> {
    let _guard = lock(&state.sources_lock);
    let mut store = load_store(state)?;
    store.remove(id)?;
    sources::save(state.root(), &store)
}

fn source(state: &ExtensionsState, id: &str) -> Result<IndexSourceEntry> {
    let _guard = lock(&state.sources_lock);
    Ok(load_store(state)?.get(id)?.clone())
}

/// A source's index as the catalog shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// The index document.
    pub index: CuratedIndex,
    /// The source has a pinned key and this index's signature verified.
    /// False means an unsigned source.
    pub signed: bool,
    /// A key rotation to offer the user: the signed index's
    /// `nextPublicKey` when it differs from the pinned key. Never set for
    /// an unsigned source, whose index could name any key.
    pub next_public_key: Option<String>,
}

fn rotation_offer(entry: &IndexSourceEntry, fetched: &FetchedIndex) -> Option<String> {
    if !fetched.signed {
        return None;
    }
    fetched
        .index
        .next_public_key
        .clone()
        .filter(|next| entry.public_key.as_deref() != Some(next.as_str()))
}

/// Fetches the index of `entry`, verifies it for a keyed source and checks
/// it is fresh with [`accept_index`]. Every read of an index goes through
/// here: the catalog, staging an install and a key rotation.
async fn fetch(state: &ExtensionsState, entry: &IndexSourceEntry) -> Result<FetchedIndex> {
    let fetched = index::fetch_index(&state.document_http, &entry.url, entry.public_key.as_deref()).await?;
    accept_index(state, entry, &fetched, unix_now())?;
    Ok(fetched)
}

/// Rollback protection for a signed index `fetched` from `entry` at `now`
/// (seconds since the epoch). It is refused with a `signature` error when
/// its `generatedAt` is before the newest one accepted from the source, or
/// its `expires` has passed; otherwise a newer `generatedAt` is recorded in
/// `sources.json`. An equal one is the same index fetched again and is
/// accepted. An unsigned index is not checked: whoever serves it can write
/// any date into it.
pub fn accept_index(state: &ExtensionsState, entry: &IndexSourceEntry, fetched: &FetchedIndex, now: u64) -> Result<()> {
    if !fetched.signed {
        return Ok(());
    }
    if !index::check_freshness(&fetched.index, entry.last_generated_at.as_deref(), now)? {
        return Ok(());
    }
    let _guard = lock(&state.sources_lock);
    let mut store = load_store(state)?;
    // A concurrent fetch may have recorded a newer index since `entry` was
    // read; check against what is stored now.
    let stored = store.get(&entry.id)?.last_generated_at.clone();
    if index::check_freshness(&fetched.index, stored.as_deref(), now)? {
        store.set_last_generated_at(&entry.id, &fetched.index.generated_at)?;
        sources::save(state.root(), &store)?;
    }
    Ok(())
}

/// Fetches and, for a keyed source, verifies the index of `source_id`.
pub async fn get_catalog(state: &ExtensionsState, source_id: &str) -> Result<Catalog> {
    let entry = source(state, source_id)?;
    let fetched = fetch(state, &entry).await?;
    Ok(catalog_of(&entry, fetched))
}

/// The catalog view of an index `fetched` from `entry`.
pub fn catalog_of(entry: &IndexSourceEntry, fetched: FetchedIndex) -> Catalog {
    Catalog {
        next_public_key: rotation_offer(entry, &fetched),
        signed: fetched.signed,
        index: fetched.index,
    }
}

/// Re-pins the key of `source_id` to `next_public_key` once the user
/// confirmed it. The index is fetched again and must verify with the key
/// pinned now and still offer exactly `next_public_key`; otherwise nothing
/// changes. There is no other way to change a pinned key.
pub async fn accept_next_key(
    state: &ExtensionsState,
    source_id: &str,
    next_public_key: &str,
) -> Result<IndexSourceEntry> {
    let entry = source(state, source_id)?;
    let fetched = fetch(state, &entry).await?;
    apply_rotation(state, &entry, &fetched, next_public_key)
}

/// The checks and the store update of [`accept_next_key`], given the index
/// `fetched` from `entry` with its key at the time.
pub fn apply_rotation(
    state: &ExtensionsState,
    entry: &IndexSourceEntry,
    fetched: &FetchedIndex,
    next_public_key: &str,
) -> Result<IndexSourceEntry> {
    let current = match (&entry.public_key, fetched.signed) {
        (Some(current), true) => current,
        _ => {
            return Err(Error::Denied(
                "only a signed index can rotate its source's key".into(),
            ))
        }
    };
    if rotation_offer(entry, fetched).as_deref() != Some(next_public_key) {
        return Err(Error::Denied(
            "the signed index does not offer this key as nextPublicKey".into(),
        ));
    }
    let _guard = lock(&state.sources_lock);
    let mut store = load_store(state)?;
    let rotated = store.rotate_key(&entry.id, current, next_public_key)?;
    sources::save(state.root(), &store)?;
    Ok(rotated)
}

/// A tarball downloaded from an index source, not yet extracted.
pub struct Downloaded {
    /// The source it came from.
    pub source: IndexSourceEntry,
    /// The index as fetched, with whether its signature verified.
    pub index: FetchedIndex,
    /// The tarball bytes, already checked against the pinned SRI.
    pub bytes: Vec<u8>,
    /// The stage slot reserved before the download.
    pub slot: StageSlot,
}

/// Fetches (and for a keyed source verifies) the index of `source_id` and
/// downloads the tarball of `id@version` it lists (https, at most 50 MiB,
/// SRI checked). A stage slot is reserved first, so no download starts
/// while the stages are full.
pub async fn download_from_index(
    state: &ExtensionsState,
    source_id: &str,
    id: &str,
    version: &str,
) -> Result<Downloaded> {
    let slot = StageSlot::reserve(state)?;
    let source = source(state, source_id)?;
    let index = fetch(state, &source).await?;
    let listed = index::resolve(&index.index, id, version)?.clone();
    let bytes = index::download_tarball(&state.index_http, &listed).await?;
    Ok(Downloaded {
        source,
        index,
        bytes,
        slot,
    })
}

/// Stages what [`download_from_index`] fetched, checking the package against
/// the listing. Blocking: it extracts to disk.
pub fn stage_downloaded(
    state: &ExtensionsState,
    downloaded: Downloaded,
    id: &str,
    version: &str,
) -> Result<StagedInstall> {
    install::stage_index_tarball(
        state,
        downloaded.slot,
        &downloaded.source,
        &downloaded.index,
        id,
        version,
        &downloaded.bytes,
    )
}
