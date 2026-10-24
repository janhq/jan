//! Index sources and catalog operations over an [`ExtensionsState`]: the
//! command bodies of `list_sources`, `add_source`, `remove_source`,
//! `get_catalog`, `stage_from_index` and `accept_next_key`.
//!
//! Every index read from a source with a pinned key is signature-checked
//! (see [`index::fetch_index`]); a failure rejects the catalog and any
//! install from it before the index is parsed.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::index::{self, CuratedIndex, FetchedIndex};
use crate::install::{self, StagedInstall};
use crate::sources::{self, IndexSourceEntry};
use crate::state::{lock, ExtensionsState, StageSlot};

/// Every source the user added.
pub fn list_sources(state: &ExtensionsState) -> Result<Vec<IndexSourceEntry>> {
    let _guard = lock(&state.sources_lock);
    Ok(sources::load(state.root())?.sources)
}

/// Adds an https index source, pinning `public_key` if given.
pub fn add_source(
    state: &ExtensionsState,
    url: &str,
    name: &str,
    public_key: Option<&str>,
) -> Result<IndexSourceEntry> {
    let _guard = lock(&state.sources_lock);
    let mut store = sources::load(state.root())?;
    let entry = store.add(url, name, public_key)?;
    sources::save(state.root(), &store)?;
    Ok(entry)
}

/// Removes a source. Extensions installed from it stay installed.
pub fn remove_source(state: &ExtensionsState, id: &str) -> Result<()> {
    let _guard = lock(&state.sources_lock);
    let mut store = sources::load(state.root())?;
    store.remove(id)?;
    sources::save(state.root(), &store)
}

fn source(state: &ExtensionsState, id: &str) -> Result<IndexSourceEntry> {
    let _guard = lock(&state.sources_lock);
    Ok(sources::load(state.root())?.get(id)?.clone())
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

async fn fetch(state: &ExtensionsState, entry: &IndexSourceEntry) -> Result<FetchedIndex> {
    index::fetch_index(&state.document_http, &entry.url, entry.public_key.as_deref()).await
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
    let mut store = sources::load(state.root())?;
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
