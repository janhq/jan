//! `<root>/extensions.json`: what is installed, from where, with which
//! grants. Written atomically; a file that cannot be read back is moved
//! aside to `extensions.json.corrupt-<ts>` and an empty registry is used, so
//! a damaged file never blocks the app and is never silently overwritten.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::StoreError;
use crate::manifest::{is_extension_id, is_semver};
use crate::store::{unix_now, write_json_atomic};

/// File name of the registry inside the extensions root.
pub const REGISTRY_FILE: &str = "extensions.json";
/// The only schema this build reads and writes.
pub const SCHEMA: u32 = 1;

/// Where an installed version came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    /// A local `.tgz` the user picked.
    #[serde(rename_all = "camelCase")]
    Bundle {
        /// The file name only, never the full path.
        file_name: String,
        /// SRI of the tarball as read.
        sha512: String,
    },
    /// A tarball listed in a user-added index source.
    #[serde(rename_all = "camelCase")]
    Index {
        /// The source's id in `sources.json`.
        source_id: String,
        /// The source's name when installed, for "From <source name>".
        source_name: String,
        /// The index URL.
        url: String,
        /// The tarball URL.
        tarball: String,
        /// The SRI the index pinned and the download matched.
        integrity: String,
    },
}

/// What is recorded about one installed version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    /// Where it came from.
    pub source: Source,
    /// From a source with a pinned key whose index signature verified, and
    /// integrity checked against the SRI that index pinned.
    pub verified: bool,
    /// The tarball matched a pinned SRI (index installs).
    #[serde(default)]
    pub integrity_checked: bool,
    /// `jan.main`, relative to the version directory.
    pub main: String,
    /// The permissions the manifest of this version requests.
    pub permissions: Vec<String>,
    /// SRI of the entry file at install time; `read_entry` refuses on change.
    pub entry_sha512: String,
    /// RFC 3339 UTC.
    pub installed_at: String,
}

/// One installed extension. The active version's record is flattened into
/// the entry, so the file reads as the data layout in the spec; the version
/// kept for rollback has its own record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Whether the extension is loaded.
    pub enabled: bool,
    /// The installed version that runs.
    pub active: String,
    /// The version kept for rollback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
    /// What the user granted; always a subset of the active permissions.
    pub granted: Vec<String>,
    /// The active version.
    #[serde(flatten)]
    pub current: VersionRecord,
    /// The record of `previous`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_record: Option<VersionRecord>,
}

/// The whole registry file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    /// Always [`SCHEMA`].
    pub schema: u32,
    /// No installed extension runs while set.
    #[serde(default)]
    pub safe_mode: bool,
    /// Keyed by extension id.
    #[serde(default)]
    pub extensions: BTreeMap<String, Entry>,
}

impl Default for Registry {
    fn default() -> Self {
        Registry {
            schema: SCHEMA,
            safe_mode: false,
            extensions: BTreeMap::new(),
        }
    }
}

impl Registry {
    /// Every id is an extension id and every version a semver version, so
    /// nothing read from the file can name a path outside its directory.
    fn is_sane(&self) -> bool {
        self.schema == SCHEMA
            && self.extensions.iter().all(|(id, e)| {
                is_extension_id(id)
                    && is_semver(&e.active)
                    && e.previous.as_deref().map_or(true, is_semver)
                    && e.previous.is_some() == e.previous_record.is_some()
            })
    }
}

/// The result of [`load`].
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
    /// The registry, empty when there was none or it was unreadable.
    pub registry: Registry,
    /// Where an unreadable file was moved, for the UI to report.
    pub recovered_from: Option<PathBuf>,
}

/// Path of the registry in `root`.
pub fn path(root: &Path) -> PathBuf {
    root.join(REGISTRY_FILE)
}

/// Reads the registry in `root`. A missing file is an empty registry; an
/// unreadable one (bad JSON, unknown schema, unsafe ids) is renamed to
/// `extensions.json.corrupt-<unix secs>` and an empty registry returned.
pub fn load(root: &Path) -> Result<Loaded, StoreError> {
    let file = path(root);
    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Loaded {
                registry: Registry::default(),
                recovered_from: None,
            })
        }
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_slice::<Registry>(&bytes) {
        Ok(registry) if registry.is_sane() => Ok(Loaded {
            registry,
            recovered_from: None,
        }),
        _ => {
            let aside = move_aside(&file)?;
            log::error!(
                "extensions registry {} is unreadable; moved to {} and starting empty",
                file.display(),
                aside.display()
            );
            Ok(Loaded {
                registry: Registry::default(),
                recovered_from: Some(aside),
            })
        }
    }
}

/// Renames a corrupt file to `<name>.corrupt-<ts>`, adding a counter if a
/// file of that name already exists, and returns the new path.
pub fn move_aside(file: &Path) -> Result<PathBuf, StoreError> {
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ts = unix_now();
    let mut aside = file.with_file_name(format!("{name}.corrupt-{ts}"));
    let mut n = 1;
    while aside.exists() {
        aside = file.with_file_name(format!("{name}.corrupt-{ts}-{n}"));
        n += 1;
    }
    fs::rename(file, &aside)?;
    Ok(aside)
}

/// Writes the registry to `root` atomically.
pub fn save(root: &Path, registry: &Registry) -> Result<(), StoreError> {
    write_json_atomic(&path(root), registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(version: &str) -> VersionRecord {
        VersionRecord {
            source: Source::Bundle {
                file_name: format!("hello-{version}.tgz"),
                sha512: "sha512-AA==".into(),
            },
            verified: false,
            integrity_checked: false,
            main: "dist/index.js".into(),
            permissions: vec!["ui:notify".into()],
            entry_sha512: "sha512-BB==".into(),
            installed_at: "2026-10-23T10:00:00Z".into(),
        }
    }

    fn sample() -> Registry {
        let mut registry = Registry::default();
        registry.extensions.insert(
            "acme.hello".into(),
            Entry {
                enabled: true,
                active: "0.2.0".into(),
                previous: Some("0.1.0".into()),
                granted: vec!["ui:notify".into()],
                current: record("0.2.0"),
                previous_record: Some(record("0.1.0")),
            },
        );
        registry
    }

    #[test]
    fn missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.registry, Registry::default());
        assert_eq!(loaded.recovered_from, None);
    }

    #[test]
    fn save_and_load_round_trip_atomically() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &sample()).unwrap();
        assert_eq!(load(dir.path()).unwrap().registry, sample());
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![REGISTRY_FILE.to_string()]);
    }

    #[test]
    fn writes_the_spec_layout() {
        let value = serde_json::to_value(sample()).unwrap();
        let entry = &value["extensions"]["acme.hello"];
        assert_eq!(value["schema"], 1);
        assert_eq!(value["safeMode"], false);
        assert_eq!(entry["active"], "0.2.0");
        assert_eq!(entry["previous"], "0.1.0");
        assert_eq!(entry["entrySha512"], "sha512-BB==");
        assert_eq!(entry["source"], json!({ "kind": "bundle", "fileName": "hello-0.2.0.tgz", "sha512": "sha512-AA==" }));
        assert_eq!(entry["verified"], false);
        assert_eq!(entry["installedAt"], "2026-10-23T10:00:00Z");
    }

    #[test]
    fn a_corrupt_file_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(path(dir.path()), b"{ not json").unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.registry, Registry::default());
        let aside = loaded.recovered_from.unwrap();
        assert!(aside
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("extensions.json.corrupt-"));
        assert_eq!(fs::read(&aside).unwrap(), b"{ not json");
        assert!(!path(dir.path()).exists());
        // A second corrupt file does not clobber the first.
        fs::write(path(dir.path()), b"[]").unwrap();
        let second = load(dir.path()).unwrap().recovered_from.unwrap();
        assert_ne!(second, aside);
        assert!(aside.exists());
    }

    #[test]
    fn unsafe_ids_and_versions_count_as_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let mut bad = serde_json::to_value(sample()).unwrap();
        bad["extensions"]["acme.hello"]["active"] = json!("../../etc");
        fs::write(path(dir.path()), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(load(dir.path()).unwrap().recovered_from.is_some());

        let mut bad = serde_json::to_value(sample()).unwrap();
        bad["schema"] = json!(2);
        fs::write(path(dir.path()), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(load(dir.path()).unwrap().recovered_from.is_some());
    }
}
