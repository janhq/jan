//! `<root>/sources.json`: the extension indexes the user added. Jan ships
//! none and has no compiled-in index URL or key; every source is one the
//! user typed in, and its public key (if given) is pinned when it is added.

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};
use crate::registry::move_aside;
use crate::store::{now_rfc3339, random_id, write_json_atomic};

/// File name of the source store inside the extensions root.
pub const SOURCES_FILE: &str = "sources.json";
/// The only schema this build reads and writes.
pub const SCHEMA: u32 = 1;
/// Sources one user may add.
pub const MAX_SOURCES: usize = 32;
/// Longest source name, in characters.
pub const MAX_NAME_CHARS: usize = 64;
/// Longest index URL, in bytes.
pub const MAX_URL_BYTES: usize = 2048;

/// One user-added index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSourceEntry {
    /// Random id, assigned when added.
    pub id: String,
    /// Shown as "From <name>".
    pub name: String,
    /// The https URL of the index JSON.
    pub url: String,
    /// Base64 ed25519 public key, pinned when the source was added. Stored
    /// now; signatures are checked from P4 on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    /// RFC 3339 UTC.
    pub added_at: String,
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    /// Always [`SCHEMA`].
    pub schema: u32,
    /// In the order they were added.
    #[serde(default)]
    pub sources: Vec<IndexSourceEntry>,
}

impl Default for Sources {
    fn default() -> Self {
        Sources {
            schema: SCHEMA,
            sources: Vec::new(),
        }
    }
}

/// Path of the store in `root`.
pub fn path(root: &Path) -> PathBuf {
    root.join(SOURCES_FILE)
}

/// Parses `url` and requires https, a host, and no credentials.
pub fn https_url(url: &str) -> Result<Url> {
    if url.len() > MAX_URL_BYTES {
        return Err(Error::Invalid("the URL is too long".into()));
    }
    let parsed =
        Url::parse(url.trim()).map_err(|_| Error::Invalid(format!("'{url}' is not an absolute URL")))?;
    if parsed.scheme() != "https" {
        return Err(Error::Invalid(format!("'{url}' must use https")));
    }
    if parsed.host_str().map_or(true, str::is_empty) {
        return Err(Error::Invalid(format!("'{url}' has no host")));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(Error::Invalid(format!("'{url}' must not contain credentials")));
    }
    Ok(parsed)
}

fn valid_key(key: &str) -> bool {
    STANDARD.decode(key).is_ok_and(|bytes| bytes.len() == 32)
}

impl Sources {
    fn is_sane(&self) -> bool {
        self.schema == SCHEMA
            && self.sources.iter().all(|s| {
                https_url(&s.url).is_ok() && s.public_key.as_deref().map_or(true, valid_key)
            })
    }

    /// The source with `id`.
    pub fn get(&self, id: &str) -> Result<&IndexSourceEntry> {
        self.sources
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| Error::NotFound(format!("no index source '{id}'")))
    }

    /// Adds a source. The URL must be https and not already added; the name
    /// is trimmed, 1-64 characters, no control characters; the key, when
    /// given, must be a base64 32-byte ed25519 public key.
    pub fn add(&mut self, url: &str, name: &str, public_key: Option<&str>) -> Result<IndexSourceEntry> {
        let url = https_url(url)?.to_string();
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
            return Err(Error::Invalid(format!(
                "the name must be 1-{MAX_NAME_CHARS} characters"
            )));
        }
        let public_key = match public_key.map(str::trim).filter(|k| !k.is_empty()) {
            Some(key) if valid_key(key) => Some(key.to_string()),
            Some(_) => {
                return Err(Error::Invalid(
                    "the public key must be a base64 ed25519 key (32 bytes)".into(),
                ))
            }
            None => None,
        };
        if self.sources.iter().any(|s| s.url == url) {
            return Err(Error::Invalid(format!("{url} is already added")));
        }
        if self.sources.len() >= MAX_SOURCES {
            return Err(Error::Denied(format!("at most {MAX_SOURCES} sources can be added")));
        }
        let entry = IndexSourceEntry {
            id: random_id(),
            name: name.to_string(),
            url,
            public_key,
            added_at: now_rfc3339(),
        };
        self.sources.push(entry.clone());
        Ok(entry)
    }

    /// Removes the source with `id`. Installed extensions keep working: they
    /// record where they came from.
    pub fn remove(&mut self, id: &str) -> Result<()> {
        let before = self.sources.len();
        self.sources.retain(|s| s.id != id);
        if self.sources.len() == before {
            return Err(Error::NotFound(format!("no index source '{id}'")));
        }
        Ok(())
    }
}

/// Reads the store in `root`. Missing is empty; unreadable is moved aside to
/// `sources.json.corrupt-<ts>` and empty.
pub fn load(root: &Path) -> Result<Sources> {
    let file = path(root);
    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Sources::default()),
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_slice::<Sources>(&bytes) {
        Ok(sources) if sources.is_sane() => Ok(sources),
        _ => {
            let aside = move_aside(&file)?;
            log::error!(
                "extension sources {} are unreadable; moved to {}",
                file.display(),
                aside.display()
            );
            Ok(Sources::default())
        }
    }
}

/// Writes the store to `root` atomically.
pub fn save(root: &Path, sources: &Sources) -> Result<()> {
    write_json_atomic(&path(root), sources)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";

    #[test]
    fn adds_removes_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let mut sources = load(dir.path()).unwrap();
        let a = sources.add("https://ext.example.com/index.json", " Example ", Some(KEY)).unwrap();
        assert_eq!(a.name, "Example");
        assert_eq!(a.public_key.as_deref(), Some(KEY));
        let b = sources.add("https://other.example.org/i.json", "Other", None).unwrap();
        save(dir.path(), &sources).unwrap();

        let mut loaded = load(dir.path()).unwrap();
        assert_eq!(loaded, sources);
        assert_eq!(loaded.get(&b.id).unwrap().url, "https://other.example.org/i.json");
        loaded.remove(&a.id).unwrap();
        assert!(matches!(loaded.remove(&a.id), Err(Error::NotFound(_))));
        assert_eq!(loaded.sources.len(), 1);
    }

    #[test]
    fn rejects_non_https_and_bad_input() {
        let mut sources = Sources::default();
        for url in [
            "http://ext.example.com/index.json",
            "file:///etc/passwd",
            "ftp://x.example.com/",
            "https://user:pw@x.example.com/",
            "not a url",
            "",
        ] {
            assert!(matches!(sources.add(url, "x", None), Err(Error::Invalid(_))), "{url}");
        }
        assert!(sources.add("https://a.example.com/", "", None).is_err());
        assert!(sources.add("https://a.example.com/", "x\u{7}", None).is_err());
        assert!(sources.add("https://a.example.com/", &"n".repeat(65), None).is_err());
        assert!(sources.add("https://a.example.com/", "x", Some("not-base64!")).is_err());
        assert!(sources.add("https://a.example.com/", "x", Some("AAAA")).is_err());
        sources.add("https://a.example.com/", "x", None).unwrap();
        assert!(sources.add("https://a.example.com/", "y", None).is_err());
        assert!(sources.sources.len() == 1);
    }

    #[test]
    fn caps_the_number_of_sources() {
        let mut sources = Sources::default();
        for i in 0..MAX_SOURCES {
            sources.add(&format!("https://s{i}.example.com/"), "s", None).unwrap();
        }
        assert!(matches!(
            sources.add("https://more.example.com/", "s", None),
            Err(Error::Denied(_))
        ));
    }

    #[test]
    fn writes_the_documented_layout() {
        let mut sources = Sources::default();
        sources.add("https://ext.example.com/index.json", "Example", Some(KEY)).unwrap();
        let value = serde_json::to_value(&sources).unwrap();
        let entry = &value["sources"][0];
        assert_eq!(value["schema"], 1);
        assert_eq!(entry["url"], "https://ext.example.com/index.json");
        assert_eq!(entry["publicKey"], KEY);
        assert!(entry["addedAt"].as_str().unwrap().ends_with('Z'));
        assert!(entry["id"].is_string());
    }

    #[test]
    fn a_corrupt_or_unsafe_file_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(path(dir.path()), "{").unwrap();
        assert_eq!(load(dir.path()).unwrap(), Sources::default());
        fs::write(
            path(dir.path()),
            r#"{"schema":1,"sources":[{"id":"x","name":"x","url":"http://plain.example.com/","addedAt":"t"}]}"#,
        )
        .unwrap();
        assert_eq!(load(dir.path()).unwrap(), Sources::default());
        let aside = fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(aside, 2);
    }
}
