//! The install pipeline and lifecycle over the pure modules: stage a
//! tarball, confirm it with the user's grants, then enable, revoke, roll
//! back, uninstall and serve the entry file.
//!
//! Nothing here runs package code: `scripts` is never read and no process
//! is spawned. Every registry change happens under `ExtensionsState::lock`,
//! and every path is built from a validated extension id and semver version.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bundle::{self, Limits};
use crate::error::{Error, Result};
use crate::integrity::sha512_sri;
use crate::manifest::{self, is_extension_id, ValidatedManifest, HOST_API_VERSION};
use crate::registry::{Entry, Registry, Source, VersionRecord};
use crate::state::{lock, ExtensionsState, Stage, MAX_STAGES, STAGING_DIR};
use crate::store::{now_rfc3339, random_id};

/// Largest tarball accepted, compressed.
pub const MAX_TARBALL_BYTES: u64 = 50 * 1024 * 1024;

/// What an update changes in the permissions the user is asked about.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDiff {
    /// Requested by the new version and not granted now: needs consent.
    pub added: Vec<String>,
    /// Requested by the installed version and no longer by the new one.
    pub removed: Vec<String>,
}

/// The installed version a stage would replace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Existing {
    /// The active version.
    pub version: String,
    /// What the user granted it.
    pub granted: Vec<String>,
}

/// A staged package, shown in the consent dialog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedInstall {
    /// Pass to `confirm_install` or `discard_stage`.
    pub stage_id: String,
    /// The package.json of the package.
    pub manifest: Value,
    /// SRI of the tarball.
    pub sha512: String,
    /// Signature-checked. False until index signatures exist (P4).
    pub verified: bool,
    /// The tarball matched an SRI pinned by an index.
    pub integrity_checked: bool,
    /// Where the tarball came from.
    pub source: Source,
    /// The installed version this would update, if any.
    pub existing: Option<Existing>,
    /// For an update, what changes; for a new install, every requested
    /// permission is in `added`.
    pub permission_diff: PermissionDiff,
}

/// One installed extension, as the UI and loader see it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    /// The extension id.
    pub id: String,
    /// The active version.
    pub version: String,
    /// The version kept for rollback.
    pub previous: Option<String>,
    /// Whether it is loaded (safe mode aside).
    pub enabled: bool,
    /// The grants.
    pub granted: Vec<String>,
    /// What the active version requests.
    pub permissions: Vec<String>,
    /// Where the active version came from.
    pub source: Source,
    /// Signature-checked.
    pub verified: bool,
    /// The tarball matched a pinned SRI.
    pub integrity_checked: bool,
    /// RFC 3339 UTC.
    pub installed_at: String,
    /// The active version's package.json, or null if it cannot be read.
    pub manifest: Value,
}

/// What `list` returns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    /// No installed extension may run.
    pub safe_mode: bool,
    /// Safe mode is forced by `JAN_EXTENSIONS_SAFE_MODE=1` and cannot be
    /// turned off from the UI.
    pub safe_mode_forced: bool,
    /// Set when an unreadable registry was moved aside at startup.
    pub recovered_from: Option<String>,
    /// Every installed extension, by id.
    pub extensions: Vec<InstalledExtension>,
}

/// The entry bundle of an enabled extension, checked against its hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySource {
    /// The bundle's source text.
    pub code: String,
    /// Its SRI, equal to the one recorded at install time.
    pub sha512: String,
}

/// What an index pinned about a tarball, checked against its manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expected {
    /// `jan.id`.
    pub id: String,
    /// package.json `version`.
    pub version: String,
    /// `jan.permissions`, compared as a set.
    pub permissions: Vec<String>,
}

fn checked_id(id: &str) -> Result<()> {
    if is_extension_id(id) {
        Ok(())
    } else {
        Err(Error::Invalid(format!("'{id}' is not an extension id")))
    }
}

fn version_dir(root: &Path, id: &str, version: &str) -> PathBuf {
    root.join(id).join(version)
}

fn read_capped(reader: impl Read, cap: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(Error::TooLarge(format!("the tarball is larger than {cap} bytes")));
    }
    Ok(bytes)
}

fn sorted_set(items: &[String]) -> BTreeSet<&str> {
    items.iter().map(String::as_str).collect()
}

fn diff(existing: Option<(&Entry, &[String])>, requested: &[String]) -> PermissionDiff {
    match existing {
        None => PermissionDiff {
            added: requested.to_vec(),
            removed: Vec::new(),
        },
        Some((entry, old_permissions)) => {
            let granted = sorted_set(&entry.granted);
            let next = sorted_set(requested);
            PermissionDiff {
                // A permission the user revoked is asked for again.
                added: requested
                    .iter()
                    .filter(|p| !granted.contains(p.as_str()))
                    .cloned()
                    .collect(),
                removed: old_permissions
                    .iter()
                    .filter(|p| !next.contains(p.as_str()))
                    .cloned()
                    .collect(),
            }
        }
    }
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Reads the `.tgz` at `path` (at most 50 MiB), extracts and validates it
/// into `.staging`. The result is unverified: anyone could have built it.
pub fn stage_bundle(state: &ExtensionsState, path: &Path) -> Result<StagedInstall> {
    let meta = fs::metadata(path)?;
    if !meta.is_file() {
        return Err(Error::Invalid(format!("{} is not a file", path.display())));
    }
    if meta.len() > MAX_TARBALL_BYTES {
        return Err(Error::TooLarge(format!(
            "the tarball is larger than {MAX_TARBALL_BYTES} bytes"
        )));
    }
    let bytes = read_capped(fs::File::open(path)?, MAX_TARBALL_BYTES)?;
    let source = Source::Bundle {
        file_name: file_name_of(path),
        sha512: sha512_sri(&bytes),
    };
    stage_tarball(state, &bytes, source, false, None)
}

/// Extracts and validates `bytes` into a new stage. `expected` is what an
/// index pinned; a manifest that disagrees with it is refused.
pub fn stage_tarball(
    state: &ExtensionsState,
    bytes: &[u8],
    source: Source,
    integrity_checked: bool,
    expected: Option<&Expected>,
) -> Result<StagedInstall> {
    if bytes.len() as u64 > MAX_TARBALL_BYTES {
        return Err(Error::TooLarge(format!(
            "the tarball is larger than {MAX_TARBALL_BYTES} bytes"
        )));
    }
    if lock(&state.stages).len() >= MAX_STAGES {
        return Err(Error::Denied(
            "too many installs are waiting for confirmation; finish or cancel one first".into(),
        ));
    }
    let sha512 = sha512_sri(bytes);
    let stage_id = random_id();
    let dir = state.root.join(STAGING_DIR).join(&stage_id);
    let extracted = bundle::extract(bytes, &dir, Limits::default())?;
    let validated = (|| -> Result<(ValidatedManifest, String)> {
        let manifest = manifest::validate_package(
            &extracted.root,
            &extracted.package_json,
            &state.options.app_version,
            HOST_API_VERSION,
        )?;
        if let Some(expected) = expected {
            check_expected(&manifest, expected)?;
        }
        let entry = manifest::check_main_file(&extracted.root, &manifest.main)?;
        let entry_sha512 = sha512_sri(&fs::read(entry)?);
        Ok((manifest, entry_sha512))
    })();
    let (manifest, entry_sha512) = match validated {
        Ok(v) => v,
        Err(e) => {
            let _ = fs::remove_dir_all(&dir);
            return Err(e);
        }
    };

    let existing = {
        let _guard = lock(&state.lock);
        let registry = state.load_registry()?;
        registry.extensions.get(&manifest.id).cloned()
    };
    let permission_diff = diff(
        existing
            .as_ref()
            .map(|e| (e, e.current.permissions.as_slice())),
        &manifest.permissions,
    );
    let staged = StagedInstall {
        stage_id: stage_id.clone(),
        manifest: manifest.package.clone(),
        sha512: sha512.clone(),
        verified: false,
        integrity_checked,
        source: source.clone(),
        existing: existing.map(|e| Existing {
            version: e.active,
            granted: e.granted,
        }),
        permission_diff,
    };
    lock(&state.stages).insert(
        stage_id.clone(),
        Stage {
            id: stage_id,
            dir,
            manifest,
            sha512,
            source,
            integrity_checked,
            entry_sha512,
        },
    );
    Ok(staged)
}

/// Refuses a manifest whose id, version or permissions differ from what
/// the index listed, so consent is given to what the catalog showed.
pub fn check_expected(manifest: &ValidatedManifest, expected: &Expected) -> Result<()> {
    if manifest.id != expected.id || manifest.version != expected.version {
        return Err(Error::Tampered(format!(
            "the tarball contains {}@{}, but the index lists {}@{}",
            manifest.id, manifest.version, expected.id, expected.version
        )));
    }
    if sorted_set(&manifest.permissions) != sorted_set(&expected.permissions)
        || manifest.permissions.len() != expected.permissions.len()
    {
        return Err(Error::Tampered(
            "the tarball requests other permissions than the index lists".into(),
        ));
    }
    Ok(())
}

fn take_stage(state: &ExtensionsState, stage_id: &str) -> Result<Stage> {
    lock(&state.stages)
        .remove(stage_id)
        .ok_or_else(|| Error::NotFound(format!("no staged install '{stage_id}'")))
}

/// Deletes a stage and its files.
pub fn discard_stage(state: &ExtensionsState, stage_id: &str) -> Result<()> {
    let stage = take_stage(state, stage_id)?;
    fs::remove_dir_all(&stage.dir)?;
    Ok(())
}

/// Removes every directory of `id` except `keep`.
fn prune_versions(root: &Path, id: &str, keep: &[&str]) {
    let Ok(entries) = fs::read_dir(root.join(id)) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !keep.contains(&name.as_str()) {
            if let Err(e) = fs::remove_dir_all(entry.path()) {
                log::warn!("cannot remove {}: {e}", entry.path().display());
            }
        }
    }
}

/// Moves a stage into `<id>/<version>` and records it. `granted` must be a
/// superset of the permissions the package requests; what is stored is the
/// requested set, so an extra entry can never grant anything. An update
/// keeps the replaced version as `previous` and deletes any older one; a
/// version lower than or equal to the active one is refused (use rollback).
pub fn confirm_install(
    state: &ExtensionsState,
    stage_id: &str,
    granted: &[String],
) -> Result<InstalledExtension> {
    let requested = {
        let stages = lock(&state.stages);
        let stage = stages
            .get(stage_id)
            .ok_or_else(|| Error::NotFound(format!("no staged install '{stage_id}'")))?;
        stage.manifest.permissions.clone()
    };
    let granted_set = sorted_set(granted);
    let missing: Vec<&str> = requested
        .iter()
        .map(String::as_str)
        .filter(|p| !granted_set.contains(p))
        .collect();
    if !missing.is_empty() {
        return Err(Error::Denied(format!(
            "the extension needs these permissions to install: {}",
            missing.join(", ")
        )));
    }

    let _guard = lock(&state.lock);
    let mut registry = state.load_registry()?;
    let stage = take_stage(state, stage_id)?;
    let id = stage.manifest.id.clone();
    let version = stage.manifest.version.clone();
    let old = registry.extensions.get(&id).cloned();
    if let Some(old) = &old {
        let newer = match (
            semver::Version::parse(&version),
            semver::Version::parse(&old.active),
        ) {
            (Ok(new), Ok(active)) => new > active,
            _ => false,
        };
        if !newer {
            let _ = fs::remove_dir_all(&stage.dir);
            return Err(Error::Denied(format!(
                "{id} {} is installed; {version} is not newer (use rollback to go back)",
                old.active
            )));
        }
    }

    let target = version_dir(&state.root, &id, &version);
    let keep_previous = old.as_ref().map(|o| o.active.clone());
    prune_versions(&state.root, &id, &[keep_previous.as_deref().unwrap_or("")]);
    fs::create_dir_all(state.root.join(&id))?;
    if let Err(e) = fs::rename(&stage.dir, &target) {
        let _ = fs::remove_dir_all(&stage.dir);
        return Err(e.into());
    }
    // The hash is taken again from the installed copy, which is what
    // read_entry will compare against.
    let entry_path = manifest::check_main_file(&target, &stage.manifest.main)?;
    let entry_sha512 = sha512_sri(&fs::read(entry_path)?);
    if entry_sha512 != stage.entry_sha512 {
        let _ = fs::remove_dir_all(&target);
        return Err(Error::Tampered("the entry file changed while staged".into()));
    }

    let record = VersionRecord {
        source: stage.source,
        verified: false,
        integrity_checked: stage.integrity_checked,
        main: stage.manifest.main.clone(),
        permissions: requested.clone(),
        entry_sha512,
        installed_at: now_rfc3339(),
    };
    let ordered_grants = requested.clone();
    let entry = match old {
        Some(old) => Entry {
            enabled: old.enabled,
            active: version.clone(),
            previous: Some(old.active),
            granted: ordered_grants,
            current: record,
            previous_record: Some(old.current),
        },
        None => Entry {
            enabled: true,
            active: version.clone(),
            previous: None,
            granted: ordered_grants,
            current: record,
            previous_record: None,
        },
    };
    registry.extensions.insert(id.clone(), entry);
    if let Err(e) = state.save_registry(&registry) {
        let _ = fs::remove_dir_all(&target);
        return Err(e);
    }
    Ok(installed(&state.root, &id, &registry.extensions[&id]))
}

fn read_manifest(root: &Path, id: &str, version: &str) -> Value {
    fs::read(version_dir(root, id, version).join("package.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

fn installed(root: &Path, id: &str, entry: &Entry) -> InstalledExtension {
    InstalledExtension {
        id: id.to_string(),
        version: entry.active.clone(),
        previous: entry.previous.clone(),
        enabled: entry.enabled,
        granted: entry.granted.clone(),
        permissions: entry.current.permissions.clone(),
        source: entry.current.source.clone(),
        verified: entry.current.verified,
        integrity_checked: entry.current.integrity_checked,
        installed_at: entry.current.installed_at.clone(),
        manifest: read_manifest(root, id, &entry.active),
    }
}

/// Every installed extension and the safe-mode state.
pub fn list(state: &ExtensionsState) -> Result<ListResult> {
    let _guard = lock(&state.lock);
    let registry = state.load_registry()?;
    Ok(ListResult {
        safe_mode: state.safe_mode(&registry),
        safe_mode_forced: state.options.safe_mode_forced,
        recovered_from: lock(&state.recovered_from)
            .as_ref()
            .map(|p| p.display().to_string()),
        extensions: registry
            .extensions
            .iter()
            .map(|(id, entry)| installed(&state.root, id, entry))
            .collect(),
    })
}

fn update<T>(
    state: &ExtensionsState,
    id: &str,
    change: impl FnOnce(&Path, &mut Registry) -> Result<T>,
) -> Result<T> {
    checked_id(id)?;
    let _guard = lock(&state.lock);
    let mut registry = state.load_registry()?;
    if !registry.extensions.contains_key(id) {
        return Err(Error::NotFound(format!("{id} is not installed")));
    }
    let result = change(&state.root, &mut registry)?;
    state.save_registry(&registry)?;
    Ok(result)
}

/// Enables or disables an installed extension.
pub fn set_enabled(state: &ExtensionsState, id: &str, enabled: bool) -> Result<()> {
    update(state, id, |_, registry| {
        if let Some(entry) = registry.extensions.get_mut(id) {
            entry.enabled = enabled;
        }
        Ok(())
    })
}

/// Replaces the grants of `id` with `granted`, which may only remove:
/// granting more needs a new consent, which only an install gives.
pub fn set_grants(state: &ExtensionsState, id: &str, granted: &[String]) -> Result<()> {
    update(state, id, |_, registry| {
        let Some(entry) = registry.extensions.get_mut(id) else {
            return Ok(());
        };
        let current = sorted_set(&entry.granted);
        if let Some(extra) = granted.iter().find(|p| !current.contains(p.as_str())) {
            return Err(Error::Denied(format!(
                "'{extra}' is not granted; grants can only be revoked here"
            )));
        }
        let keep = sorted_set(granted);
        entry.granted.retain(|p| keep.contains(p.as_str()));
        Ok(())
    })
}

/// Removes `<id>/` and the registry entry.
pub fn uninstall(state: &ExtensionsState, id: &str) -> Result<()> {
    update(state, id, |root, registry| {
        registry.extensions.remove(id);
        match fs::remove_dir_all(root.join(id)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    })
}

/// Makes the previous version active and the active one previous. The
/// grants shrink to what the restored version requests; nothing is added.
pub fn rollback(state: &ExtensionsState, id: &str) -> Result<InstalledExtension> {
    update(state, id, |root, registry| {
        let Some(entry) = registry.extensions.get_mut(id) else {
            return Err(Error::NotFound(format!("{id} is not installed")));
        };
        let (Some(previous), Some(previous_record)) =
            (entry.previous.clone(), entry.previous_record.clone())
        else {
            return Err(Error::NotFound(format!("{id} has no previous version")));
        };
        if !version_dir(root, id, &previous).is_dir() {
            return Err(Error::NotFound(format!(
                "the files of {id} {previous} are missing"
            )));
        }
        let restored = sorted_set(&previous_record.permissions);
        entry.granted.retain(|p| restored.contains(p.as_str()));
        let old_active = std::mem::replace(&mut entry.active, previous);
        let old_record = std::mem::replace(&mut entry.current, previous_record);
        entry.previous = Some(old_active);
        entry.previous_record = Some(old_record);
        Ok(installed(root, id, entry))
    })
}

/// Turns the persisted safe mode on or off. `JAN_EXTENSIONS_SAFE_MODE=1`
/// still forces it on for this run.
pub fn set_safe_mode(state: &ExtensionsState, on: bool) -> Result<()> {
    let _guard = lock(&state.lock);
    let mut registry = state.load_registry()?;
    registry.safe_mode = on;
    state.save_registry(&registry)
}

/// The entry bundle of `id`, only when it is enabled, safe mode is off, and
/// the file still hashes to what was recorded at install time.
pub fn read_entry(state: &ExtensionsState, id: &str) -> Result<EntrySource> {
    checked_id(id)?;
    let _guard = lock(&state.lock);
    let registry = state.load_registry()?;
    if state.safe_mode(&registry) {
        return Err(Error::Denied("extensions do not run in safe mode".into()));
    }
    let entry = registry
        .extensions
        .get(id)
        .ok_or_else(|| Error::NotFound(format!("{id} is not installed")))?;
    if !entry.enabled {
        return Err(Error::Denied(format!("{id} is disabled")));
    }
    let path = manifest::check_main_file(
        &version_dir(&state.root, id, &entry.active),
        &entry.current.main,
    )?;
    let bytes = fs::read(path)?;
    let sha512 = sha512_sri(&bytes);
    if sha512 != entry.current.entry_sha512 {
        return Err(Error::Tampered(format!(
            "the entry file of {id} changed after it was installed; reinstall it"
        )));
    }
    let code = String::from_utf8(bytes)
        .map_err(|_| Error::Invalid(format!("the entry file of {id} is not UTF-8")))?;
    Ok(EntrySource { code, sha512 })
}

/// The grants of an enabled extension, for the network check. Read from
/// `extensions.json` on every call, so a revoke applies to the next request.
pub(crate) fn network_grants(state: &ExtensionsState, id: &str) -> Result<Vec<String>> {
    checked_id(id)?;
    let _guard = lock(&state.lock);
    let registry = state.load_registry()?;
    if state.safe_mode(&registry) {
        return Err(Error::Denied("extensions do not run in safe mode".into()));
    }
    let entry = registry
        .extensions
        .get(id)
        .ok_or_else(|| Error::NotFound(format!("{id} is not installed")))?;
    if !entry.enabled {
        return Err(Error::Denied(format!("{id} is disabled")));
    }
    Ok(entry.granted.clone())
}
