//! Index sources and catalog operations over an [`ExtensionsState`]: the
//! command bodies of `list_sources`, `add_source`, `remove_source`,
//! `get_catalog` and `stage_from_index`.

use crate::error::Result;
use crate::index::{self, CuratedIndex, IndexSource};
use crate::install::{self, StagedInstall};
use crate::sources::{self, IndexSourceEntry};
use crate::state::{lock, ExtensionsState};

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

/// Fetches the index of source `source_id`.
pub async fn get_catalog(state: &ExtensionsState, source_id: &str) -> Result<CuratedIndex> {
    let entry = source(state, source_id)?;
    index::fetch_index(&state.index_http, &IndexSource::Url(entry.url)).await
}

/// A tarball downloaded from an index source, not yet extracted.
pub struct Downloaded {
    /// The source it came from.
    pub source: IndexSourceEntry,
    /// The index as fetched.
    pub index: CuratedIndex,
    /// The tarball bytes, already checked against the pinned SRI.
    pub bytes: Vec<u8>,
}

/// Fetches the index of `source_id` and downloads the tarball of
/// `id@version` it lists (https, at most 50 MiB, SRI checked).
pub async fn download_from_index(
    state: &ExtensionsState,
    source_id: &str,
    id: &str,
    version: &str,
) -> Result<Downloaded> {
    let source = source(state, source_id)?;
    let index = index::fetch_index(&state.index_http, &IndexSource::Url(source.url.clone())).await?;
    let listed = index::resolve(&index, id, version)?.clone();
    let bytes = index::download_tarball(&state.index_http, &listed).await?;
    Ok(Downloaded {
        source,
        index,
        bytes,
    })
}

/// Stages what [`download_from_index`] fetched, checking the package against
/// the listing. Blocking: it extracts to disk.
pub fn stage_downloaded(
    state: &ExtensionsState,
    downloaded: &Downloaded,
    id: &str,
    version: &str,
) -> Result<StagedInstall> {
    install::stage_index_tarball(
        state,
        &downloaded.source,
        &downloaded.index,
        id,
        version,
        &downloaded.bytes,
    )
}
