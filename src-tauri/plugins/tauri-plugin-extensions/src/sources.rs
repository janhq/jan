//! `<root>/sources.json`: the extension indexes the user added. Jan ships
//! none and has no compiled-in index URL or key; every source is one the
//! user typed in, and its public key (if given) is pinned when it is added.
//!
//! The file also remembers, per keyed source, the newest `generatedAt` an
//! accepted signed index carried (rollback protection), and the keys of
//! keyed sources the user removed, so re-adding one of those URLs without a
//! key can be flagged in the UI.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};
use crate::registry::move_aside;
use crate::signature::is_public_key;
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
/// Removed pins remembered; the oldest is forgotten first.
pub const MAX_REMOVED_PINS: usize = 64;

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
    /// Base64 ed25519 public key, pinned when the source was added. When
    /// set, every index from the source must carry a valid signature by it;
    /// it only changes through a confirmed `nextPublicKey` rotation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    /// RFC 3339 UTC.
    pub added_at: String,
    /// The `generatedAt` of the newest signed index accepted from this
    /// source, as written in that index. An index generated earlier is a
    /// replay and is refused. Only kept for a keyed source: an unsigned
    /// index can claim any date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_generated_at: Option<String>,
}

/// The key a keyed source had when the user removed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedPin {
    /// The source's index URL, as stored.
    pub url: String,
    /// The key that was pinned for it.
    pub public_key: String,
    /// RFC 3339 UTC.
    pub removed_at: String,
}

/// A source entry that failed the checks on load and was dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedSource {
    /// Its name, when it had a readable one.
    pub name: Option<String>,
    /// Its URL, when it had a readable one.
    pub url: Option<String>,
    /// Why it was dropped.
    pub reason: String,
}

/// What loading the store had to repair. The file as it was is kept at
/// `moved_to`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesNotice {
    /// Where the unrepaired file was kept.
    pub moved_to: String,
    /// The dropped entries. Empty when the whole file was unreadable and
    /// every source was lost.
    pub dropped: Vec<DroppedSource>,
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
    /// Keys of removed keyed sources, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_pins: Vec<RemovedPin>,
}

impl Default for Sources {
    fn default() -> Self {
        Sources {
            schema: SCHEMA,
            sources: Vec::new(),
            removed_pins: Vec::new(),
        }
    }
}

/// The file as read before the entries are checked one by one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSources {
    schema: u32,
    #[serde(default)]
    sources: Vec<serde_json::Value>,
    #[serde(default)]
    removed_pins: Vec<serde_json::Value>,
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

/// Why a stored entry cannot be used, if it cannot.
fn entry_problem(entry: &IndexSourceEntry) -> Option<String> {
    if let Err(e) = https_url(&entry.url) {
        return Some(e.to_string());
    }
    if entry.public_key.as_deref().is_some_and(|k| !is_public_key(k)) {
        return Some("its pinned key is not a valid ed25519 public key".into());
    }
    None
}

fn dropped(value: &serde_json::Value, reason: String) -> DroppedSource {
    let field = |name: &str| value.get(name).and_then(serde_json::Value::as_str).map(str::to_string);
    DroppedSource {
        name: field("name"),
        url: field("url"),
        reason,
    }
}

impl Sources {
    /// Checks the entries of `raw` one by one: a bad source is dropped and
    /// reported, the others are kept. A bad removed pin is only advisory and
    /// is dropped silently.
    fn from_raw(raw: RawSources) -> (Sources, Vec<DroppedSource>) {
        let mut sources = Sources::default();
        let mut bad = Vec::new();
        for value in raw.sources {
            match serde_json::from_value::<IndexSourceEntry>(value.clone()) {
                Ok(entry) => match entry_problem(&entry) {
                    Some(reason) => bad.push(dropped(&value, reason)),
                    None if sources.sources.iter().any(|s| s.id == entry.id || s.url == entry.url) => {
                        bad.push(dropped(&value, "it repeats another source".into()))
                    }
                    None => sources.sources.push(entry),
                },
                Err(e) => bad.push(dropped(&value, format!("it is malformed: {e}"))),
            }
        }
        sources.removed_pins = raw
            .removed_pins
            .into_iter()
            .filter_map(|v| serde_json::from_value::<RemovedPin>(v).ok())
            .filter(|p| https_url(&p.url).is_ok() && is_public_key(&p.public_key))
            .collect();
        (sources, bad)
    }

    /// The key that was pinned for `url` when a keyed source with that URL
    /// was last removed.
    pub fn removed_pin(&self, url: &str) -> Option<&RemovedPin> {
        let url = https_url(url).ok()?.to_string();
        self.removed_pins.iter().find(|p| p.url == url)
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
            Some(key) if is_public_key(key) => Some(key.to_string()),
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
        // Pinning a key again settles the earlier removal; adding without
        // one keeps the pin on record, so the next add still warns.
        if public_key.is_some() {
            self.removed_pins.retain(|p| p.url != url);
        }
        let entry = IndexSourceEntry {
            id: random_id(),
            name: name.to_string(),
            url,
            public_key,
            added_at: now_rfc3339(),
            last_generated_at: None,
        };
        self.sources.push(entry.clone());
        Ok(entry)
    }

    /// Re-pins the key of source `id` from `current` to `next`. Refused when
    /// the source has no key or its key is no longer `current`, so a
    /// rotation offered by one index never applies over another change.
    pub fn rotate_key(&mut self, id: &str, current: &str, next: &str) -> Result<IndexSourceEntry> {
        if !is_public_key(next) {
            return Err(Error::Invalid(
                "the next public key must be a base64 ed25519 key (32 bytes)".into(),
            ));
        }
        let entry = self
            .sources
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| Error::NotFound(format!("no index source '{id}'")))?;
        match entry.public_key.as_deref() {
            None => {
                return Err(Error::Denied(
                    "an unsigned source has no key to rotate; add it again with a key".into(),
                ))
            }
            Some(pinned) if pinned != current => {
                return Err(Error::Denied("the source's key changed meanwhile".into()))
            }
            Some(_) => {}
        }
        entry.public_key = Some(next.to_string());
        Ok(entry.clone())
    }

    /// Removes the source with `id`. Installed extensions keep working: they
    /// record where they came from. A keyed source's key is remembered as a
    /// removed pin.
    pub fn remove(&mut self, id: &str) -> Result<()> {
        let at = self
            .sources
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| Error::NotFound(format!("no index source '{id}'")))?;
        let removed = self.sources.remove(at);
        if let Some(public_key) = removed.public_key {
            self.removed_pins.retain(|p| p.url != removed.url);
            self.removed_pins.push(RemovedPin {
                url: removed.url,
                public_key,
                removed_at: now_rfc3339(),
            });
            let excess = self.removed_pins.len().saturating_sub(MAX_REMOVED_PINS);
            self.removed_pins.drain(..excess);
        }
        Ok(())
    }

    /// Records that a signed index generated at `generated_at` was accepted
    /// from source `id`.
    pub fn set_last_generated_at(&mut self, id: &str, generated_at: &str) -> Result<()> {
        let entry = self
            .sources
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| Error::NotFound(format!("no index source '{id}'")))?;
        entry.last_generated_at = Some(generated_at.to_string());
        Ok(())
    }
}

/// Reads the store in `root`, repairing what it must; see [`load_reporting`].
pub fn load(root: &Path) -> Result<Sources> {
    Ok(load_reporting(root)?.0)
}

/// Reads the store in `root`. Missing is empty. A file that is not JSON or
/// has another schema is moved aside to `sources.json.corrupt-<ts>` and
/// read as empty. A source entry that fails the checks (a plain-http URL,
/// a key the current checks refuse) costs only that entry: the file is
/// moved aside as it was, the remaining sources are written back, and the
/// notice says which were dropped. Either repair returns a notice.
pub fn load_reporting(root: &Path) -> Result<(Sources, Option<SourcesNotice>)> {
    let file = path(root);
    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Sources::default(), None)),
        Err(e) => return Err(e.into()),
    };
    let (sources, dropped) = match serde_json::from_slice::<RawSources>(&bytes) {
        Ok(raw) if raw.schema == SCHEMA => {
            let (sources, dropped) = Sources::from_raw(raw);
            if dropped.is_empty() {
                return Ok((sources, None));
            }
            (sources, dropped)
        }
        _ => (Sources::default(), Vec::new()),
    };
    let aside = move_aside(&file)?;
    log::error!(
        "extension sources {}: {}; the file as it was is at {}",
        file.display(),
        if dropped.is_empty() {
            "unreadable, every source was dropped".to_string()
        } else {
            format!("{} invalid source(s) dropped", dropped.len())
        },
        aside.display()
    );
    if !dropped.is_empty() {
        save(root, &sources)?;
    }
    let notice = SourcesNotice {
        moved_to: aside.to_string_lossy().into_owned(),
        dropped,
    };
    Ok((sources, Some(notice)))
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
    fn rotates_only_a_pinned_key_still_in_place() {
        const NEXT: &str = "PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=";
        let mut sources = Sources::default();
        let keyed = sources.add("https://a.example.com/", "a", Some(KEY)).unwrap();
        let open = sources.add("https://b.example.com/", "b", None).unwrap();
        assert!(matches!(sources.rotate_key(&open.id, KEY, NEXT), Err(Error::Denied(_))));
        assert!(matches!(sources.rotate_key(&keyed.id, NEXT, NEXT), Err(Error::Denied(_))));
        assert!(matches!(sources.rotate_key(&keyed.id, KEY, "AAAA"), Err(Error::Invalid(_))));
        assert!(matches!(sources.rotate_key("nope", KEY, NEXT), Err(Error::NotFound(_))));
        assert_eq!(sources.get(&keyed.id).unwrap().public_key.as_deref(), Some(KEY));
        let rotated = sources.rotate_key(&keyed.id, KEY, NEXT).unwrap();
        assert_eq!(rotated.public_key.as_deref(), Some(NEXT));
        assert_eq!(sources.get(&keyed.id).unwrap(), &rotated);
    }

    #[test]
    fn a_weak_key_is_not_pinned() {
        let mut sources = Sources::default();
        let zero = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        assert!(matches!(sources.add("https://a.example.com/", "a", Some(zero)), Err(Error::Invalid(_))));
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
    fn a_corrupt_file_or_its_only_unsafe_entry_is_moved_aside() {
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
