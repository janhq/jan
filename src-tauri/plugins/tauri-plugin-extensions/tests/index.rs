//! Acceptance tests of index installs: fetch against a local listener,
//! the listing/manifest checks, the source store and what the registry
//! records.

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_extensions::catalog;
use tauri_plugin_extensions::error::Error;
use tauri_plugin_extensions::index::{self, CuratedIndex};
use tauri_plugin_extensions::install;
use tauri_plugin_extensions::integrity::sha512_sri;
use tauri_plugin_extensions::registry::{self, Source};
use tauri_plugin_extensions::sources::IndexSourceEntry;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ID: &str = "acme.hello";

fn listing(tarball: &[u8], permissions: &[&str]) -> CuratedIndex {
    index::parse(
        &serde_json::to_vec(&json!({
            "schema": 1,
            "generatedAt": "2026-10-24T00:00:00Z",
            "extensions": [{
                "id": ID, "displayName": "Hello", "publisher": "Acme",
                "versions": [{
                    "version": "0.1.0",
                    "tarball": "https://cdn.example.com/hello-0.1.0.tgz",
                    "integrity": sha512_sri(tarball),
                    "apiVersion": "^0.1.0",
                    "engines": { "jan": ">=0.8.0" },
                    "permissions": permissions,
                }]
            }]
        }))
        .unwrap(),
    )
    .unwrap()
}

fn source() -> IndexSourceEntry {
    IndexSourceEntry {
        id: "0123456789abcdef0123456789abcdef".into(),
        name: "Acme index".into(),
        url: "https://index.example.com/index.json".into(),
        public_key: None,
        added_at: "2026-10-24T00:00:00Z".into(),
    }
}

#[test]
fn stages_and_records_an_index_install() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let tarball = extension(ID, "0.1.0", &["ui:notify", "tools"]);
    // Order does not matter, the set does.
    let index = listing(&tarball, &["tools", "ui:notify"]);
    let staged = install::stage_index_tarball(&state, &source(), &index, ID, "0.1.0", &tarball).unwrap();
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
        let err = install::stage_index_tarball(&state, &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
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
        let err = install::stage_index_tarball(&state, &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
        assert!(matches!(err, Error::Tampered(_)), "{err}");
    }
}

#[test]
fn a_tarball_that_does_not_match_its_pin_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let index = listing(&extension(ID, "0.1.0", &["tools"]), &["ui:notify"]);
    let err = install::stage_index_tarball(&state, &source(), &index, ID, "0.1.0", &tarball).unwrap_err();
    assert!(matches!(err, Error::Integrity(_)), "{err}");
}

#[test]
fn the_source_store_adds_removes_and_rejects_plain_http() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    assert!(catalog::list_sources(&state).unwrap().is_empty());
    let added = catalog::add_source(&state, "https://index.example.com/index.json", "Acme", None).unwrap();
    assert!(matches!(
        catalog::add_source(&state, "http://index.example.com/index.json", "Plain", None),
        Err(Error::Invalid(_))
    ));
    assert_eq!(catalog::list_sources(&state).unwrap(), vec![added.clone()]);
    assert!(root.path().join("sources.json").is_file());
    catalog::remove_source(&state, &added.id).unwrap();
    assert!(catalog::list_sources(&state).unwrap().is_empty());
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
    // way to point one at http; it is moved aside rather than used.
    std::fs::write(
        root.path().join("sources.json"),
        r#"{"schema":1,"sources":[{"id":"s","name":"x","url":"http://127.0.0.1:9/i.json","addedAt":"t"}]}"#,
    )
    .unwrap();
    assert!(matches!(catalog::get_catalog(&state, "s").await, Err(Error::NotFound(_))));

    let tarball = extension(ID, "0.1.0", &["ui:notify"]);
    let mut listed = listing(&tarball, &["ui:notify"]).extensions[0].versions[0].clone();
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
    let staged = install::stage_index_tarball(&state, &source(), &index, ID, "0.1.0", &tarball).unwrap();
    assert_eq!(staged.existing.unwrap().version, "0.0.9");
    assert_eq!(staged.permission_diff.added, strings(&["tools"]));
    let installed = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify", "tools"])).unwrap();
    assert!(matches!(installed.source, Source::Index { .. }));
    assert!(matches!(
        registry::load(root.path()).unwrap().registry.extensions[ID].previous_record.as_ref().unwrap().source,
        Source::Bundle { .. }
    ));
}
