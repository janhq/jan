//! The index format (schema 1) and how an index, its signature and its
//! tarballs are fetched.
//!
//! The index of a source with a pinned key must come with a detached
//! signature (see [`crate::signature`]); it is checked over the exact bytes
//! before the index is parsed. A source without a key is read unsigned and
//! labelled as such.
//!
//! An index lists extensions and, per version, an https tarball URL pinned
//! by a sha512 SRI plus the permissions it requests. Installing from an index
//! downloads the tarball, checks the SRI, and refuses a package whose
//! manifest id, version or permissions differ from the listing, so the
//! consent the user gives matches what the catalog showed.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result, SignatureError};
use crate::integrity::{self, is_sri};
use crate::manifest::{is_caret_range, is_extension_id, is_reserved_id, is_semver};
use crate::permissions::is_permission_string;
use crate::signature::{self, is_public_key, MAX_SIGNATURE_BYTES};
use crate::store::parse_rfc3339;

/// Largest index document.
pub const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;
/// Timeout of an index fetch.
pub const INDEX_TIMEOUT: Duration = Duration::from_secs(15);
/// Largest tarball.
pub const MAX_TARBALL_BYTES: usize = 50 * 1024 * 1024;
/// Timeout of a tarball download.
pub const TARBALL_TIMEOUT: Duration = Duration::from_secs(300);
/// The only index schema this build reads.
pub const SCHEMA: u32 = 1;

/// One version of an indexed extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexVersion {
    /// Semver version, equal to the tarball's package.json `version`.
    pub version: String,
    /// https URL of the `.tgz`.
    pub tarball: String,
    /// `sha512-<base64>` of the tarball.
    pub integrity: String,
    /// The manifest's `jan.apiVersion`, for display and filtering.
    pub api_version: String,
    /// The manifest's `engines`, for display and filtering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engines: Option<IndexEngines>,
    /// Exactly the manifest's `jan.permissions`.
    pub permissions: Vec<String>,
    /// An https link to a provenance attestation the index maintainer
    /// checked. Shown as reported by the source; Jan does not verify it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}

/// `engines` of an index version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexEngines {
    /// The app versions the extension supports.
    pub jan: String,
}

/// One extension in an index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexExtension {
    /// Extension id.
    pub id: String,
    /// Shown in the catalog.
    pub display_name: String,
    /// Shown in the catalog.
    pub publisher: String,
    /// Shown in the catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// An https link shown in the catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    /// Available versions.
    pub versions: Vec<IndexVersion>,
}

/// An index document (`CuratedIndex` in the spec).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CuratedIndex {
    /// Always [`SCHEMA`].
    pub schema: u32,
    /// When the index was generated, as given. For a keyed source it must
    /// be RFC 3339: an index older than one accepted before is refused.
    pub generated_at: String,
    /// RFC 3339 time after which a keyed source's index is refused, so a
    /// signed index cannot be served forever. Ignored for unsigned sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// A base64 ed25519 key the maintainer will sign with next. Only offered
    /// to the user from a signed index, and only re-pinned once confirmed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_public_key: Option<String>,
    /// The listed extensions.
    pub extensions: Vec<IndexExtension>,
}

/// An index as read from a source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchedIndex {
    /// The parsed document.
    pub index: CuratedIndex,
    /// True when the source has a pinned key and the signature verified.
    pub signed: bool,
}

fn is_https(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| !h.is_empty())
            && u.username().is_empty()
            && u.password().is_none()
    })
}

/// Parses and checks an index document. Every listed tarball must be https
/// and pinned by a sha512 SRI, every id, version and permission must be
/// well formed, and ids and versions must be unique.
pub fn parse(bytes: &[u8]) -> Result<CuratedIndex> {
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(Error::TooLarge(format!("the index is larger than {MAX_INDEX_BYTES} bytes")));
    }
    let schema = serde_json::from_slice::<serde_json::Value>(bytes)
        .map_err(|e| Error::Invalid(format!("the index is not JSON: {e}")))?
        .get("schema")
        .and_then(serde_json::Value::as_u64);
    if schema != Some(u64::from(SCHEMA)) {
        return Err(Error::Invalid(format!(
            "the index has schema {}, and this Jan reads schema {SCHEMA}",
            schema.map_or("none".to_string(), |s| s.to_string())
        )));
    }
    let index: CuratedIndex = serde_json::from_slice(bytes)
        .map_err(|e| Error::Invalid(format!("the index is malformed: {e}")))?;
    let bad = |what: String| Err(Error::Invalid(format!("the index lists {what}")));
    if index.next_public_key.as_deref().is_some_and(|k| !is_public_key(k)) {
        return bad("a nextPublicKey that is not a base64 ed25519 key".into());
    }
    let mut ids = BTreeSet::new();
    for ext in &index.extensions {
        if !is_extension_id(&ext.id) {
            return bad(format!("an invalid extension id '{}'", ext.id));
        }
        if is_reserved_id(&ext.id) {
            return bad(format!("'{}', an id reserved for Jan's built-in extensions", ext.id));
        }
        if !ids.insert(ext.id.as_str()) {
            return bad(format!("{} twice", ext.id));
        }
        if ext.homepage.as_deref().is_some_and(|h| !is_https(h)) {
            return bad(format!("a homepage for {} that is not https", ext.id));
        }
        let mut versions = BTreeSet::new();
        for v in &ext.versions {
            let at = format!("{}@{}", ext.id, v.version);
            if !is_semver(&v.version) {
                return bad(format!("an invalid version for {}", ext.id));
            }
            if !versions.insert(v.version.as_str()) {
                return bad(format!("{at} twice"));
            }
            if !is_https(&v.tarball) {
                return bad(format!("a tarball for {at} that is not https"));
            }
            if !is_sri(&v.integrity) {
                return bad(format!("an integrity for {at} that is not a sha512 SRI"));
            }
            if v.provenance.as_deref().is_some_and(|p| !is_https(p)) {
                return bad(format!("a provenance for {at} that is not https"));
            }
            if !is_caret_range(&v.api_version) {
                return bad(format!("an apiVersion for {at} that is not a caret range"));
            }
            let mut perms = BTreeSet::new();
            for p in &v.permissions {
                if !is_permission_string(p) || !perms.insert(p.as_str()) {
                    return bad(format!("an invalid or repeated permission '{p}' for {at}"));
                }
            }
        }
    }
    Ok(index)
}

/// Checks the freshness of a signed index: `generatedAt` must not be older
/// than `last`, the newest one accepted from the source before (equal is
/// the same index fetched again), and a signed `expires` must not have
/// passed at `now` (seconds since the epoch). Returns whether
/// `generatedAt` is newer than `last`, so the caller records it.
pub fn check_freshness(index: &CuratedIndex, last: Option<&str>, now: u64) -> Result<bool> {
    let generated = parse_rfc3339(&index.generated_at).ok_or(SignatureError::BadTimestamp("generatedAt"))?;
    if let Some(expires) = &index.expires {
        let (at, nanos) = parse_rfc3339(expires).ok_or(SignatureError::BadTimestamp("expires"))?;
        let now = i64::try_from(now).unwrap_or(i64::MAX);
        if now > at || (now == at && nanos == 0) {
            return Err(SignatureError::Expired(expires.clone()).into());
        }
    }
    // A stored value that no longer parses is ignored rather than locking
    // the source out; it is replaced by this index's time.
    let Some((last, last_at)) = last.and_then(|l| parse_rfc3339(l).map(|at| (l, at))) else {
        return Ok(true);
    };
    if generated < last_at {
        return Err(SignatureError::Rollback {
            generated_at: index.generated_at.clone(),
            last: last.to_string(),
        }
        .into());
    }
    Ok(generated > last_at)
}

/// The listing of exactly `id@version`.
pub fn resolve<'a>(index: &'a CuratedIndex, id: &str, version: &str) -> Result<&'a IndexVersion> {
    let ext = index
        .extensions
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::NotFound(format!("the index does not list {id}")))?;
    ext.versions
        .iter()
        .find(|v| v.version == version)
        .ok_or_else(|| Error::NotFound(format!("the index does not list {id}@{version}")))
}

/// Why a redirect of a tarball download is refused, if it is.
///
/// Redirects stay allowed because common tarball hosts (GitHub release
/// assets, CDNs) answer with one to another host. A hop must stay on https
/// and name a host by DNS: an IP literal or a localhost name is refused, so
/// a listing cannot bounce Jan onto loopback or a private address it spells
/// out. A name that resolves to a private address is the accepted DNS risk
/// described in [`crate::http`]; TLS still has to verify for it.
pub fn redirect_refusal(url: &Url) -> Option<&'static str> {
    if url.scheme() != "https" {
        return Some("redirect away from https");
    }
    match url.host() {
        Some(url::Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if name == "localhost" || name.ends_with(".localhost") {
                Some("redirect to localhost")
            } else {
                None
            }
        }
        Some(_) => Some("redirect to an IP address"),
        None => Some("redirect without a host"),
    }
}

/// The client used for tarballs: no cookies, at most 5 redirects, each
/// checked by [`redirect_refusal`]. Index documents use
/// [`document_client`], which follows none.
pub fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            match redirect_refusal(attempt.url()) {
                Some(reason) => attempt.error(reason),
                None => attempt.follow(),
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Network(format!("cannot create the HTTP client: {e}")))
}

/// GETs `url` with `client`, failing on a non-2xx status, after `timeout`,
/// or once the body passes `cap` bytes (counted as it arrives).
pub async fn get_capped(client: &reqwest::Client, url: &str, cap: usize, timeout: Duration) -> Result<Vec<u8>> {
    let work = async {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| Error::Network(format!("cannot fetch {url}: {e}")))?;
        if !response.status().is_success() {
            return Err(Error::Network(format!("{url} answered {}", response.status())));
        }
        if response.content_length().is_some_and(|n| n > cap as u64) {
            return Err(Error::TooLarge(format!("{url} is larger than {cap} bytes")));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Error::Network(format!("cannot read {url}: {e}")))?
        {
            if body.len() + chunk.len() > cap {
                return Err(Error::TooLarge(format!("{url} is larger than {cap} bytes")));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    };
    tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| Error::Network(format!("{url} timed out")))?
}

/// The client used for index documents and their signatures: no cookies
/// and no redirects, so a 3xx fails the fetch. A signed index binds its
/// bytes, but neither it nor its `.sig` has a reason to move.
pub fn document_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Network(format!("cannot create the HTTP client: {e}")))
}

/// Checks `bytes` against the pinned `public_key`, if any, then parses
/// them. `signature` is what fetching the `.sig` gave; it is only looked at
/// for a keyed source, where a missing, malformed or wrong signature
/// rejects the index before any of it is parsed.
pub fn verify_and_parse(
    bytes: &[u8],
    signature: Option<Result<Vec<u8>>>,
    public_key: Option<&str>,
) -> Result<FetchedIndex> {
    let signed = match public_key {
        None => false,
        Some(key) => {
            let sig = match signature {
                Some(Ok(sig)) => sig,
                Some(Err(e)) => return Err(SignatureError::Missing(e.to_string()).into()),
                None => return Err(SignatureError::Missing("it was not fetched".into()).into()),
            };
            signature::verify_index(bytes, &sig, key)?;
            true
        }
    };
    Ok(FetchedIndex {
        index: parse(bytes)?,
        signed,
    })
}

/// Fetches the index at `url` (https only, 2 MiB, 15 s) and, for a source
/// with a pinned `public_key`, its `<url>.sig` with the same client
/// (1 KiB, 15 s), and checks it with [`verify_and_parse`].
pub async fn fetch_index(client: &reqwest::Client, url: &str, public_key: Option<&str>) -> Result<FetchedIndex> {
    let url = crate::sources::https_url(url)?;
    fetch_index_at(client, &url, public_key).await
}

/// [`fetch_index`] without the https check, so tests can serve an index
/// and its signature from a local plain-http listener.
pub async fn fetch_index_at(client: &reqwest::Client, url: &Url, public_key: Option<&str>) -> Result<FetchedIndex> {
    let bytes = get_capped(client, url.as_str(), MAX_INDEX_BYTES, INDEX_TIMEOUT).await?;
    let signature = match public_key {
        Some(_) => {
            let sig_url = signature::signature_url(url);
            Some(get_capped(client, sig_url.as_str(), MAX_SIGNATURE_BYTES, INDEX_TIMEOUT).await)
        }
        None => None,
    };
    verify_and_parse(&bytes, signature, public_key)
}

/// Downloads the tarball of `version` (https only, at most 50 MiB) and
/// checks it against the pinned SRI.
pub async fn download_tarball(client: &reqwest::Client, version: &IndexVersion) -> Result<Vec<u8>> {
    if !is_https(&version.tarball) {
        return Err(Error::Invalid(format!("{} is not an https URL", version.tarball)));
    }
    let bytes = get_capped(client, &version.tarball, MAX_TARBALL_BYTES, TARBALL_TIMEOUT).await?;
    integrity::verify(&bytes, &version.integrity)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redirects_only_reach_named_https_hosts() {
        let refused = |u: &str| redirect_refusal(&Url::parse(u).unwrap());
        for ok in [
            "https://objects.githubusercontent.com/x.tgz",
            "https://cdn.example.com/a",
        ] {
            assert_eq!(refused(ok), None, "{ok}");
        }
        for bad in [
            "http://cdn.example.com/a",
            "https://127.0.0.1/",
            "https://127.1/",
            "https://0x7f000001/",
            "https://10.0.0.5/",
            "https://192.168.1.1/",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://localhost/",
            "https://LOCALHOST./",
            "https://api.localhost/",
        ] {
            assert!(refused(bad).is_some(), "{bad}");
        }
    }

    const SRI: &str = "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==";

    fn sample() -> serde_json::Value {
        json!({
            "schema": 1,
            "generatedAt": "2026-10-24T00:00:00Z",
            "extensions": [{
                "id": "acme.hello",
                "displayName": "Hello",
                "publisher": "Acme",
                "description": "Says hello",
                "homepage": "https://acme.example.com",
                "versions": [
                    { "version": "0.1.0", "tarball": "https://cdn.example.com/hello-0.1.0.tgz",
                      "integrity": SRI, "apiVersion": "^1.0.0", "engines": { "jan": ">=0.8.0" },
                      "permissions": ["ui:notify"] },
                    { "version": "0.2.0", "tarball": "https://cdn.example.com/hello-0.2.0.tgz",
                      "integrity": SRI, "apiVersion": "^1.0.0", "permissions": ["ui:notify", "tools"] }
                ]
            }]
        })
    }

    fn parse_value(v: &serde_json::Value) -> Result<CuratedIndex> {
        parse(&serde_json::to_vec(v).unwrap())
    }

    #[test]
    fn parses_the_documented_format() {
        let index = parse_value(&sample()).unwrap();
        assert_eq!(index.extensions[0].versions.len(), 2);
        assert_eq!(
            index.extensions[0].versions[0].engines,
            Some(IndexEngines { jan: ">=0.8.0".into() })
        );
        // Serializes back to the same shape.
        assert_eq!(serde_json::to_value(&index).unwrap(), sample());
    }

    #[test]
    fn rejects_an_unknown_schema() {
        for schema in [json!(2), json!(0), json!("1"), serde_json::Value::Null] {
            let mut v = sample();
            v["schema"] = schema;
            assert!(matches!(parse_value(&v), Err(Error::Invalid(m)) if m.contains("schema")));
        }
        let mut v = sample();
        v.as_object_mut().unwrap().remove("schema");
        assert!(parse_value(&v).is_err());
    }

    #[test]
    fn rejects_a_non_https_tarball() {
        for url in ["http://cdn.example.com/x.tgz", "file:///x.tgz", "https://u:p@cdn.example.com/x.tgz", "x.tgz"] {
            let mut v = sample();
            v["extensions"][0]["versions"][0]["tarball"] = json!(url);
            assert!(parse_value(&v).is_err(), "{url}");
        }
    }

    #[test]
    fn rejects_a_bad_sri() {
        for sri in ["sha1-abc", "sha512-", "sha512-%%%", "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="] {
            let mut v = sample();
            v["extensions"][0]["versions"][0]["integrity"] = json!(sri);
            assert!(parse_value(&v).is_err(), "{sri}");
        }
    }

    #[test]
    fn rejects_malformed_entries() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            ("/extensions/0/id", json!("Acme.Hello")),
            ("/extensions/0/id", json!("jan.hello")),
            ("/extensions/0/homepage", json!("http://acme.example.com")),
            ("/extensions/0/versions/0/version", json!("1.0")),
            ("/extensions/0/versions/1/version", json!("0.1.0")),
            ("/extensions/0/versions/0/apiVersion", json!(">=0.1.0")),
            ("/extensions/0/versions/0/permissions", json!(["fs:write"])),
            ("/extensions/0/versions/0/permissions", json!(["tools", "tools"])),
            ("/extensions/0/extra", json!(1)),
        ];
        for (pointer, value) in cases {
            let mut v = sample();
            let (parent, key) = pointer.rsplit_once('/').unwrap();
            v.pointer_mut(parent).unwrap()[key] = value;
            assert!(parse_value(&v).is_err(), "{pointer}");
        }
        let mut v = sample();
        let dup = v["extensions"][0].clone();
        v["extensions"].as_array_mut().unwrap().push(dup);
        assert!(parse_value(&v).is_err());
    }

    #[test]
    fn rejects_an_oversized_index() {
        assert!(matches!(parse(&vec![b' '; MAX_INDEX_BYTES + 1]), Err(Error::TooLarge(_))));
    }

    #[test]
    fn resolve_picks_the_exact_version() {
        let index = parse_value(&sample()).unwrap();
        assert_eq!(resolve(&index, "acme.hello", "0.2.0").unwrap().permissions, vec!["ui:notify", "tools"]);
        assert_eq!(resolve(&index, "acme.hello", "0.1.0").unwrap().version, "0.1.0");
        assert!(matches!(resolve(&index, "acme.hello", "0.2"), Err(Error::NotFound(_))));
        assert!(matches!(resolve(&index, "acme.hello", "^0.1.0"), Err(Error::NotFound(_))));
        assert!(matches!(resolve(&index, "acme.other", "0.1.0"), Err(Error::NotFound(_))));
    }

    #[tokio::test]
    async fn fetch_refuses_plain_http() {
        let client = document_client().unwrap();
        for key in [None, Some(signature::tests::public_key(&signature::tests::signing_key(7)))] {
            let err = fetch_index(&client, "http://127.0.0.1:9/index.json", key.as_deref())
                .await
                .unwrap_err();
            assert!(matches!(err, Error::Invalid(_)), "{err}");
        }
    }
}
