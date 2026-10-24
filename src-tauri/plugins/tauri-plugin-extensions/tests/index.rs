//! Acceptance tests of index installs: fetch against a local listener,
//! the listing/manifest checks, the source store and what the registry
//! records.

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_extensions::catalog;
use tauri_plugin_extensions::error::Error;
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use tauri_plugin_extensions::error::SignatureError;
use tauri_plugin_extensions::index::{self, FetchedIndex};
use tauri_plugin_extensions::install;
use tauri_plugin_extensions::integrity::sha512_sri;
use tauri_plugin_extensions::registry::{self, Source};
use tauri_plugin_extensions::sources::IndexSourceEntry;
use tauri_plugin_extensions::state::{ExtensionsState, StageSlot};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ID: &str = "acme.hello";

fn listing(tarball: &[u8], permissions: &[&str]) -> FetchedIndex {
    FetchedIndex {
        index: index::parse(&listing_bytes(tarball, permissions)).unwrap(),
        signed: false,
    }
}

fn listing_bytes(tarball: &[u8], permissions: &[&str]) -> Vec<u8> {
    serde_json::to_vec(&json!({
            "schema": 1,
            "generatedAt": "2026-10-24T00:00:00Z",
            "extensions": [{
                "id": ID, "displayName": "Hello", "publisher": "Acme",
                "versions": [{
                    "version": "0.1.0",
                    "tarball": "https://cdn.example.com/hello-0.1.0.tgz",
                    "integrity": sha512_sri(tarball),
                    "apiVersion": "^1.0.0",
                    "engines": { "jan": ">=0.8.0" },
                    "permissions": permissions,
                }]
            }]
        }))
        .unwrap()
}

fn slot(state: &ExtensionsState) -> StageSlot {
    StageSlot::reserve(state).unwrap()
}

fn source() -> IndexSourceEntry {
    IndexSourceEntry {
        id: "0123456789abcdef0123456789abcdef".into(),
        name: "Acme index".into(),
        url: "https://index.example.com/index.json".into(),
        public_key: None,
        added_at: "2026-10-24T00:00:00Z".into(),
        last_generated_at: None,
    }
}

#[test]
fn stages_and_records_an_index_install() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let tarball = extension(ID, "0.1.0", &["ui:notify", "tools"]);
    // Order does not matter, the set does.
    let index = listing(&tarball, &["tools", "ui:notify"]);
    let staged = install::stage_index_tarball(&state, slot(&state), &source(), &index, ID, "0.1.0", &tarball).unwrap();
    assert!(staged.integrity_checked);
    assert!(!staged.verified);
    assert!(matches!(&staged.source, Source::Index { source_name, .. } if source_name == "Acme index"));
    install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify", "tools"])).unwrap();

    let entry = &registry::load(root.path()).unwrap().registry.extensions[ID];
    let value = serde_json::to_value(entry).unwrap();
    assert_eq!(
        value["source"],
        json!({
            "kind": "index",
            "sourceId": "0123456789abcdef0123456789abcdef",
            "sourceName": "Acme index",
            "url": "https://index.example.com/index.json",
            "tarball": "https://cdn.example.com/hello-0.1.0.tgz",
            "integrity": sha512_sri(&tarball),
        })
    );
    assert_eq!(value["integrityChecked"], true);
    assert_eq!(value["verified"], false);
}

#[test]
fn a_manifest_index_permission_mismatch_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    for listed in [&["ui:notify"][..], &["ui:notify", "tools"][..]] {
        let tarball = extension(ID, "0.1.0", &["ui:notify", "network:*"]);
        let index = listing(&tarball, listed);
        let err = install::stage_index_tarball(&state, slot(&state), &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
        assert!(matches!(err, Error::Tampered(_)), "{listed:?}: {err}");
    }
    let staging = root.path().join(".staging");
    assert_eq!(std::fs::read_dir(&staging).map(|d| d.count()).unwrap_or(0), 0);
}

#[test]
fn an_id_or_version_mismatch_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    for tarball in [extension("acme.other", "0.1.0", &["ui:notify"]), extension(ID, "0.1.1", &["ui:notify"])] {
        let index = listing(&tarball, &["ui:notify"]);
        let err = install::stage_index_tarball(&state, slot(&state), &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
        assert!(matches!(err, Error::Tampered(_)), "{err}");
    }
}

#[test]
fn a_tarball_that_does_not_match_its_pin_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let index = listing(&extension(ID, "0.1.0", &["tools"]), &["ui:notify"]);
    let err = install::stage_index_tarball(&state, slot(&state), &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
    assert!(matches!(err, Error::Integrity(_)), "{err}");
}

#[test]
fn the_source_store_adds_removes_and_rejects_plain_http() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    assert!(catalog::list_sources(&state).unwrap().sources.is_empty());
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Acme", None).unwrap();
    assert!(matches!(
        catalog::add_source(&state, "http://index.example.com/index.json", "Plain", None),
        Err(Error::Invalid(_))
    ));
    assert_eq!(catalog::list_sources(&state).unwrap().sources, vec![added.clone()]);
    assert!(root.path().join("sources.json").is_file());
    catalog::remove_source(&state, &added.id).unwrap();
    assert!(catalog::list_sources(&state).unwrap().sources.is_empty());
}

/// Serves `body` once on 127.0.0.1 with `status`.
async fn serve_once(status: &'static str, body: Vec<u8>) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 4096];
        let _ = socket.read(&mut buf).await.unwrap();
        let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        socket.write_all(head.as_bytes()).await.unwrap();
        socket.write_all(&body).await.unwrap();
        socket.shutdown().await.ok();
    });
    port
}

#[tokio::test]
async fn fetches_and_caps_over_a_local_listener() {
    let client = index::client().unwrap();
    let doc = serde_json::to_vec(&json!({ "schema": 1, "generatedAt": "x", "extensions": [] })).unwrap();
    let port = serve_once("200 OK", doc).await;
    let bytes = index::get_capped(
        &client,
        &format!("http://127.0.0.1:{port}/index.json"),
        index::MAX_INDEX_BYTES,
        index::INDEX_TIMEOUT,
    )
    .await
    .unwrap();
    assert!(index::parse(&bytes).unwrap().extensions.is_empty());

    let port = serve_once("200 OK", vec![b' '; 4096]).await;
    let err = index::get_capped(&client, &format!("http://127.0.0.1:{port}/"), 1024, index::INDEX_TIMEOUT)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::TooLarge(_)), "{err}");

    let port = serve_once("404 Not Found", Vec::new()).await;
    let err = index::get_capped(&client, &format!("http://127.0.0.1:{port}/"), 1024, index::INDEX_TIMEOUT)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Network(_)), "{err}");
}

#[tokio::test]
async fn catalog_and_index_installs_refuse_plain_http() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    // A source can only be https, so a tampered sources.json is the only
    // way to point one at http; the entry is dropped rather than used.
    std::fs::write(
        root.path().join("sources.json"),
        r#"{"schema":1,"sources":[{"id":"s","name":"x","url":"http://127.0.0.1:9/i.json","addedAt":"t"}]}"#,
    )
    .unwrap();
    assert!(matches!(catalog::get_catalog(&state, "s").await, Err(Error::NotFound(_))));

    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let mut listed = listing(&tarball, &["ui:notify"]).index.extensions[0].versions[0].clone();
    listed.tarball = "http://127.0.0.1:9/hello.tgz".into();
    let err = index::download_tarball(&index::client().unwrap(), &listed).await.unwrap_err();
    assert!(matches!(err, Error::Invalid(_)), "{err}");
}

#[test]
fn an_index_update_of_a_bundle_install_diffs_against_its_grants() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let path = write(files.path(), "hello.tgz", &extension(ID, "0.0.9", &["ui:notify"]));
    let staged = install::stage_bundle(&state, &path).unwrap();
    install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify"])).unwrap();

    let tarball = extension(ID, "0.1.0", &["ui:notify", "tools"]);
    let index = listing(&tarball, &["ui:notify", "tools"]);
    let staged = install::stage_index_tarball(&state, slot(&state), &source(), &index, ID, "0.1.0", &tarball).unwrap();
    assert_eq!(staged.existing.unwrap().version, "0.0.9");
    assert_eq!(staged.permission_diff.added, strings(&["tools"]));
    let installed = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify", "tools"])).unwrap();
    assert!(matches!(installed.source, Source::Index { .. }));
    assert!(matches!(
        registry::load(root.path()).unwrap().registry.extensions[ID].previous_record.as_ref().unwrap().source,
        Source::Bundle { .. }
    ));
}

#[tokio::test]
async fn index_and_tarball_fetches_refuse_redirects_to_ip_literals() {
    // A second listener stands for an internal service; the redirect must
    // never reach it, whatever its scheme.
    let internal = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let internal_port = internal.local_addr().unwrap().port();
    let client = index::client().unwrap();
    for scheme in ["https", "http"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let location = format!("{scheme}://127.0.0.1:{internal_port}/admin");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let _ = socket.read(&mut buf).await.unwrap();
            let head = format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.shutdown().await.ok();
        });
        let err = index::get_capped(&client, &format!("http://127.0.0.1:{port}/index.json"), 1024, index::INDEX_TIMEOUT)
            .await
            .unwrap_err();
        assert!(matches!(err, Error::Network(_)), "{err}");
    }
    let reached = tokio::time::timeout(std::time::Duration::from_millis(200), internal.accept()).await;
    assert!(reached.is_err(), "a redirect reached the internal listener");
}

/// A fixed test keypair: never use outside tests.
fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn public_key(key: &SigningKey) -> String {
    STANDARD.encode(key.verifying_key().to_bytes())
}

/// The contents of a `.sig` file: base64 of the signature, newline.
fn sign(key: &SigningKey, bytes: &[u8]) -> Vec<u8> {
    format!("{}\n", STANDARD.encode(key.sign(bytes).to_bytes())).into_bytes()
}

/// One served path: (path, status line, body).
type Route = (&'static str, &'static str, Vec<u8>);

/// Serves `routes` (path, status, body) on 127.0.0.1 until the test ends;
/// any other path is a 404. Returns the base URL.
async fn serve(routes: Vec<Route>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return };
            let mut buf = vec![0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).into_owned();
            let path = request.split_whitespace().nth(1).unwrap_or("").to_string();
            let (status, body) = routes
                .iter()
                .find(|(p, _, _)| *p == path)
                .map(|(_, s, b)| (*s, b.clone()))
                .unwrap_or(("404 Not Found", Vec::new()));
            let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&body).await;
            let _ = socket.shutdown().await;
        }
    });
    format!("http://127.0.0.1:{port}")
}

async fn fetch_at(base: &str, key: Option<&str>) -> Result<FetchedIndex, Error> {
    let url = url::Url::parse(&format!("{base}/index.json")).unwrap();
    index::fetch_index_at(&index::document_client().unwrap(), &url, key).await
}

fn keyed_source(key: &str) -> IndexSourceEntry {
    IndexSourceEntry {
        public_key: Some(key.to_string()),
        ..source()
    }
}

#[tokio::test]
async fn a_keyed_source_installs_verified_from_a_signed_index() {
    let key = signing_key(7);
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let doc = listing_bytes(&tarball, &["ui:notify"]);
    let base = serve(vec![
        ("/index.json", "200 OK", doc.clone()),
        ("/index.json.sig", "200 OK", sign(&key, &doc)),
    ])
    .await;
    let fetched = fetch_at(&base, Some(&public_key(&key))).await.unwrap();
    assert!(fetched.signed);

    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let source = keyed_source(&public_key(&key));
    let staged = install::stage_index_tarball(&state, slot(&state), &source, &fetched, ID, "0.1.0", &tarball).unwrap();
    assert!(staged.verified && staged.integrity_checked);
    let installed = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify"])).unwrap();
    assert!(installed.verified);
    let value = serde_json::to_value(&registry::load(root.path()).unwrap().registry.extensions[ID]).unwrap();
    assert_eq!(value["verified"], true);
    assert_eq!(value["integrityChecked"], true);
    assert!(install::list(&state).unwrap().extensions[0].verified);
}

#[tokio::test]
async fn an_unkeyed_source_reads_unsigned_and_never_verifies() {
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let doc = listing_bytes(&tarball, &["ui:notify"]);
    // A .sig that would verify is ignored: without a pinned key there is
    // nothing to trust it against.
    let key = signing_key(7);
    let base = serve(vec![
        ("/index.json", "200 OK", doc.clone()),
        ("/index.json.sig", "200 OK", sign(&key, &doc)),
    ])
    .await;
    let fetched = fetch_at(&base, None).await.unwrap();
    assert!(!fetched.signed);
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let staged = install::stage_index_tarball(&state, slot(&state), &source(), &fetched, ID, "0.1.0", &tarball).unwrap();
    assert!(!staged.verified && staged.integrity_checked);
}

#[tokio::test]
async fn a_keyed_source_rejects_a_bad_or_missing_signature() {
    let key = signing_key(7);
    let pinned = public_key(&key);
    let doc = listing_bytes(&extension(ID, "0.1.0", &["ui:notify"]), &["ui:notify"]);
    let mut tampered = doc.clone();
    let at = tampered.iter().position(|b| *b == b'H').unwrap();
    tampered[at] = b'J';
    let good = String::from_utf8(sign(&key, &doc)).unwrap();
    let cases: Vec<(&str, Vec<Route>, SignatureError)> = vec![
        (
            "tampered index byte",
            vec![("/index.json", "200 OK", tampered), ("/index.json.sig", "200 OK", sign(&key, &doc))],
            SignatureError::Mismatch,
        ),
        (
            "signed by another key",
            vec![("/index.json", "200 OK", doc.clone()), ("/index.json.sig", "200 OK", sign(&signing_key(8), &doc))],
            SignatureError::Mismatch,
        ),
        (
            "truncated signature",
            vec![("/index.json", "200 OK", doc.clone()), ("/index.json.sig", "200 OK", good.trim().as_bytes()[..60].to_vec())],
            SignatureError::Malformed,
        ),
        (
            "non-base64 signature",
            vec![("/index.json", "200 OK", doc.clone()), ("/index.json.sig", "200 OK", b"%%% not a signature %%%".to_vec())],
            SignatureError::Malformed,
        ),
        (
            "missing .sig",
            vec![("/index.json", "200 OK", doc.clone())],
            SignatureError::Missing(String::new()),
        ),
        (
            "redirected .sig",
            vec![("/index.json", "200 OK", doc.clone()), ("/index.json.sig", "302 Found", Vec::new())],
            SignatureError::Missing(String::new()),
        ),
    ];
    for (what, routes, expected) in cases {
        let base = serve(routes).await;
        let err = fetch_at(&base, Some(&pinned)).await.unwrap_err();
        let ok = match (&err, &expected) {
            (Error::Signature(SignatureError::Missing(_)), SignatureError::Missing(_)) => true,
            (Error::Signature(got), want) => got == want,
            _ => false,
        };
        assert!(ok, "{what}: {err}");
        assert_eq!(err.kind(), "signature", "{what}");
    }
}

#[test]
fn a_bad_signature_rejects_before_the_index_is_parsed() {
    let key = signing_key(7);
    // Not even JSON: a keyed source must fail on the signature, not on
    // parsing, so nothing of an unauthenticated index is ever interpreted.
    let err = index::verify_and_parse(b"{ not json", Some(Ok(sign(&signing_key(8), b"x"))), Some(&public_key(&key)))
        .unwrap_err();
    assert!(matches!(err, Error::Signature(SignatureError::Mismatch)), "{err}");
    let err = index::verify_and_parse(b"{ not json", None, Some(&public_key(&key))).unwrap_err();
    assert!(matches!(err, Error::Signature(SignatureError::Missing(_))), "{err}");
    // A good signature over a bad document still fails to parse.
    let err = index::verify_and_parse(b"{ not json", Some(Ok(sign(&key, b"{ not json"))), Some(&public_key(&key)))
        .unwrap_err();
    assert!(matches!(err, Error::Invalid(_)), "{err}");
}

#[test]
fn a_verified_flag_needs_a_pinned_integrity_too() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let staged = install::stage_tarball(
        &state,
        slot(&state),
        &tarball,
        Source::Bundle { file_name: "x.tgz".into(), sha512: sha512_sri(&tarball) },
        install::Trust { integrity_checked: false, verified: true },
        None,
    )
    .unwrap();
    assert!(!staged.verified);
}

fn rotating_index(next: Option<&str>) -> Vec<u8> {
    let mut doc: serde_json::Value = serde_json::from_slice(&listing_bytes(&extension(ID, "0.1.0", &[]), &[])).unwrap();
    if let Some(next) = next {
        doc["nextPublicKey"] = json!(next);
    }
    serde_json::to_vec(&doc).unwrap()
}

#[test]
fn accepting_a_next_public_key_repins_only_on_explicit_confirmation() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let old = signing_key(7);
    let new = signing_key(9);
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Acme", Some(&public_key(&old))).unwrap();
    let doc = rotating_index(Some(&public_key(&new)));
    let fetched = index::verify_and_parse(&doc, Some(Ok(sign(&old, &doc))), Some(&public_key(&old))).unwrap();

    // Reading the catalog only offers the key; nothing is re-pinned.
    let view = catalog::catalog_of(&added, fetched.clone());
    assert!(view.signed);
    assert_eq!(view.next_public_key.as_deref(), Some(public_key(&new).as_str()));
    assert_eq!(catalog::list_sources(&state).unwrap().sources[0].public_key.as_deref(), Some(public_key(&old).as_str()));

    // Some other key than the one offered is refused.
    let err = catalog::apply_rotation(&state, &added, &fetched, &public_key(&signing_key(10))).unwrap_err();
    assert!(matches!(err, Error::Denied(_)), "{err}");
    // The user's confirmation re-pins exactly the offered key.
    let rotated = catalog::apply_rotation(&state, &added, &fetched, &public_key(&new)).unwrap();
    assert_eq!(rotated.public_key.as_deref(), Some(public_key(&new).as_str()));
    assert_eq!(catalog::list_sources(&state).unwrap().sources, vec![rotated.clone()]);

    // The old key's signatures no longer verify; the new key's do.
    let next_doc = rotating_index(None);
    assert!(index::verify_and_parse(&next_doc, Some(Ok(sign(&old, &next_doc))), Some(&public_key(&new))).is_err());
    assert!(index::verify_and_parse(&next_doc, Some(Ok(sign(&new, &next_doc))), Some(&public_key(&new))).unwrap().signed);

    // A stale offer (the key was rotated since) changes nothing.
    let err = catalog::apply_rotation(&state, &added, &fetched, &public_key(&new)).unwrap_err();
    assert!(matches!(err, Error::Denied(_)), "{err}");
}

#[test]
fn an_unsigned_index_cannot_offer_a_key() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let next = public_key(&signing_key(9));
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Open", None).unwrap();
    let doc = rotating_index(Some(&next));
    let fetched = index::verify_and_parse(&doc, None, None).unwrap();
    let view = catalog::catalog_of(&added, fetched.clone());
    assert!(!view.signed);
    assert_eq!(view.next_public_key, None);
    let err = catalog::apply_rotation(&state, &added, &fetched, &next).unwrap_err();
    assert!(matches!(err, Error::Denied(_)), "{err}");
    assert_eq!(catalog::list_sources(&state).unwrap().sources[0].public_key, None);
}

#[test]
fn provenance_and_next_public_key_are_checked_and_kept() {
    let tarball = extension(ID, "0.1.0", &[]);
    let mut doc: serde_json::Value = serde_json::from_slice(&listing_bytes(&tarball, &[])).unwrap();
    doc["extensions"][0]["versions"][0]["provenance"] = json!("https://search.sigstore.dev/?hash=abc");
    let index = index::parse(&serde_json::to_vec(&doc).unwrap()).unwrap();
    assert_eq!(index.extensions[0].versions[0].provenance.as_deref(), Some("https://search.sigstore.dev/?hash=abc"));
    let mut bad = doc.clone();
    bad["extensions"][0]["versions"][0]["provenance"] = json!("http://plain.example.com/");
    assert!(index::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
    let mut bad = doc.clone();
    bad["nextPublicKey"] = json!("AAAA");
    assert!(index::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
}

/// The index document of `listing_bytes` with `generatedAt` and `expires`.
fn dated_index(generated_at: &str, expires: Option<&str>) -> Vec<u8> {
    let mut doc: serde_json::Value = serde_json::from_slice(&listing_bytes(&extension(ID, "0.1.0", &[]), &[])).unwrap();
    doc["generatedAt"] = json!(generated_at);
    if let Some(expires) = expires {
        doc["expires"] = json!(expires);
    }
    serde_json::to_vec(&doc).unwrap()
}

/// Seconds since the epoch of 2026-10-24T12:00:00Z.
const NOON: u64 = 1_792_843_200;

fn stored(state: &ExtensionsState) -> IndexSourceEntry {
    catalog::list_sources(state).unwrap().sources[0].clone()
}

#[test]
fn a_replayed_older_signed_index_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let key = signing_key(7);
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Acme", Some(&public_key(&key))).unwrap();
    let signed = |doc: &[u8]| index::verify_and_parse(doc, Some(Ok(sign(&key, doc))), Some(&public_key(&key))).unwrap();
    let old = signed(&dated_index("2026-10-20T00:00:00Z", None));
    let new = signed(&dated_index("2026-10-22T00:00:00+02:00", None));

    // The first signed index is accepted and its generatedAt recorded.
    catalog::accept_index(&state, &added, &new, NOON).unwrap();
    assert_eq!(stored(&state).last_generated_at.as_deref(), Some("2026-10-22T00:00:00+02:00"));
    // Fetching the same index again is fine.
    catalog::accept_index(&state, &stored(&state), &new, NOON).unwrap();
    // The older one, validly signed by the same key, is a replay. Also
    // checked against the store, not only the caller's copy of the entry.
    for entry in [stored(&state), added.clone()] {
        let err = catalog::accept_index(&state, &entry, &old, NOON).unwrap_err();
        assert!(matches!(err, Error::Signature(SignatureError::Rollback { .. })), "{err}");
        assert_eq!(err.kind(), "signature");
    }
    assert_eq!(stored(&state).last_generated_at.as_deref(), Some("2026-10-22T00:00:00+02:00"));
    // A newer one moves the mark forward; compared as instants, not text.
    let newer = signed(&dated_index("2026-10-21T23:00:00Z", None));
    catalog::accept_index(&state, &stored(&state), &newer, NOON).unwrap();
    assert_eq!(stored(&state).last_generated_at.as_deref(), Some("2026-10-21T23:00:00Z"));
    // The mark survives a restart.
    let reopened = common::state(root.path());
    let err = catalog::accept_index(&reopened, &stored(&reopened), &new, NOON).unwrap_err();
    assert!(matches!(err, Error::Signature(SignatureError::Rollback { .. })), "{err}");
}

#[test]
fn an_expired_or_undated_signed_index_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let key = signing_key(7);
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Acme", Some(&public_key(&key))).unwrap();
    let signed = |doc: &[u8]| index::verify_and_parse(doc, Some(Ok(sign(&key, doc))), Some(&public_key(&key))).unwrap();

    let expired = signed(&dated_index("2026-10-20T00:00:00Z", Some("2026-10-24T11:59:59Z")));
    let err = catalog::accept_index(&state, &added, &expired, NOON).unwrap_err();
    assert!(matches!(err, Error::Signature(SignatureError::Expired(_))), "{err}");
    assert_eq!(stored(&state).last_generated_at, None);
    let at_expiry = signed(&dated_index("2026-10-20T00:00:00Z", Some("2026-10-24T12:00:00Z")));
    assert!(catalog::accept_index(&state, &added, &at_expiry, NOON).is_err());

    let valid = signed(&dated_index("2026-10-20T00:00:00Z", Some("2026-10-25T00:00:00Z")));
    catalog::accept_index(&state, &added, &valid, NOON).unwrap();

    for (generated, expires) in [("yesterday", None), ("2026-10-20T00:00:00Z", Some("soon"))] {
        let undated = signed(&dated_index(generated, expires));
        let err = catalog::accept_index(&state, &stored(&state), &undated, NOON).unwrap_err();
        assert!(matches!(err, Error::Signature(SignatureError::BadTimestamp(_))), "{err}");
    }
}

#[test]
fn an_unsigned_index_is_not_dated_or_recorded() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Open", None).unwrap();
    let doc = dated_index("whenever", Some("2000-01-01T00:00:00Z"));
    let fetched = index::verify_and_parse(&doc, None, None).unwrap();
    catalog::accept_index(&state, &added, &fetched, NOON).unwrap();
    assert_eq!(stored(&state).last_generated_at, None);
}

#[tokio::test]
async fn a_replayed_index_served_over_the_wire_is_refused() {
    let key = signing_key(7);
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let doc = listing_bytes(&tarball, &["ui:notify"]);
    let base = serve(vec![
        ("/index.json", "200 OK", doc.clone()),
        ("/index.json.sig", "200 OK", sign(&key, &doc)),
    ])
    .await;
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    // The local listener is plain http, which add_source refuses; write
    // the store as a later one would look, with a newer index accepted.
    std::fs::write(
        root.path().join("sources.json"),
        serde_json::to_vec(&json!({
            "schema": 1,
            "sources": [{
                "id": "s", "name": "Acme", "url": "https://index.example.com/index.json",
                "publicKey": public_key(&key), "addedAt": "t",
                "lastGeneratedAt": "2026-10-25T00:00:00Z",
            }],
        }))
        .unwrap(),
    )
    .unwrap();
    // The signature verifies; only the freshness check refuses it. The
    // catalog, `stage_from_index` and `accept_next_key` all fetch through
    // `catalog::fetch`, which runs this check.
    let fetched = fetch_at(&base, Some(&public_key(&key))).await.unwrap();
    assert!(fetched.signed);
    let err = catalog::accept_index(&state, &stored(&state), &fetched, NOON).unwrap_err();
    assert!(matches!(err, Error::Signature(SignatureError::Rollback { .. })), "{err}");
}

#[test]
fn removing_a_keyed_source_remembers_its_pin() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let key = public_key(&signing_key(7));
    let url = "https://index.example.com/index.json";
    let keyed = catalog::add_source(&state, url, "Acme", Some(&key)).unwrap();
    let open = catalog::add_source(&state, "https://open.example.com/i.json", "Open", None).unwrap();
    catalog::remove_source(&state, &open.id).unwrap();
    assert!(catalog::list_sources(&state).unwrap().removed_pins.is_empty());

    catalog::remove_source(&state, &keyed.id).unwrap();
    let pins = catalog::list_sources(&state).unwrap().removed_pins;
    assert_eq!(pins.len(), 1);
    assert_eq!((pins[0].url.as_str(), pins[0].public_key.as_str()), (url, key.as_str()));

    // Re-added without a key, the pin stays on record for the next warning.
    let readded = catalog::add_source(&state, url, "Acme", None).unwrap();
    assert_eq!(catalog::list_sources(&state).unwrap().removed_pins.len(), 1);
    catalog::remove_source(&state, &readded.id).unwrap();
    // Re-added with a key, the removal is settled.
    catalog::add_source(&state, url, "Acme", Some(&key)).unwrap();
    assert!(catalog::list_sources(&state).unwrap().removed_pins.is_empty());
}

#[test]
fn one_bad_source_entry_is_dropped_and_reported() {
    let root = tempfile::tempdir().unwrap();
    let key = public_key(&signing_key(7));
    let weak = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    std::fs::write(
        root.path().join("sources.json"),
        serde_json::to_vec(&json!({
            "schema": 1,
            "sources": [
                { "id": "a", "name": "Keyed", "url": "https://a.example.com/i.json", "publicKey": key, "addedAt": "t" },
                { "id": "b", "name": "Weak", "url": "https://b.example.com/i.json", "publicKey": weak, "addedAt": "t" },
                { "id": "c", "name": "Open", "url": "https://c.example.com/i.json", "addedAt": "t" },
                { "id": "d", "name": 7 },
            ],
        }))
        .unwrap(),
    )
    .unwrap();
    let state = state(root.path());
    let listed = catalog::list_sources(&state).unwrap();
    let ids: Vec<&str> = listed.sources.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["a", "c"]);
    let notice = listed.notice.expect("a notice");
    assert_eq!(notice.dropped.len(), 2);
    assert_eq!(notice.dropped[0].name.as_deref(), Some("Weak"));
    assert_eq!(notice.dropped[0].url.as_deref(), Some("https://b.example.com/i.json"));
    assert_eq!(notice.dropped[1].name, None);
    // The original is kept aside, and the repaired store was written back.
    assert!(std::fs::read(&notice.moved_to).unwrap().windows(4).any(|w| w == b"Weak"));
    let reopened = common::state(root.path());
    let again = catalog::list_sources(&reopened).unwrap();
    assert_eq!(again.sources.len(), 2);
    assert!(again.notice.is_none());
    // The notice stays for the rest of the session.
    assert!(catalog::list_sources(&state).unwrap().notice.is_some());
}
