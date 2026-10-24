//! Acceptance tests of the install pipeline and lifecycle, against a temp
//! root and without a Tauri runtime.

mod common;

use std::fs;

use common::*;
use tauri_plugin_extensions::error::Error;
use tauri_plugin_extensions::http::{self, HttpRequest, HttpStreamEvent};
use tauri_plugin_extensions::install::{self, PermissionDiff};
use tauri_plugin_extensions::registry::{self, Source};
use tauri_plugin_extensions::state::{ExtensionsState, Options, STAGING_DIR};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ID: &str = "acme.hello";

fn install_version(state: &ExtensionsState, dir: &std::path::Path, version: &str, perms: &[&str]) {
    let path = write(dir, &format!("hello-{version}.tgz"), &extension(ID, version, perms));
    let staged = install::stage_bundle(state, &path).unwrap();
    install::confirm_install(state, &staged.stage_id, &strings(perms)).unwrap();
}

#[test]
fn stages_and_confirms_a_bundle() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let path = write(files.path(), "hello.tgz", &extension(ID, "0.1.0", &["ui:notify"]));

    let staged = install::stage_bundle(&state, &path).unwrap();
    assert!(!staged.verified);
    assert!(!staged.integrity_checked);
    assert_eq!(staged.existing, None);
    assert_eq!(
        staged.permission_diff,
        PermissionDiff { added: strings(&["ui:notify"]), removed: vec![] }
    );
    assert_eq!(staged.manifest["jan"]["id"], ID);
    assert!(matches!(&staged.source, Source::Bundle { file_name, .. } if file_name == "hello.tgz"));
    assert!(root.path().join(STAGING_DIR).join(&staged.stage_id).join("package.json").is_file());

    let installed = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify"])).unwrap();
    assert_eq!(installed.id, ID);
    assert_eq!(installed.version, "0.1.0");
    assert!(installed.enabled);
    assert_eq!(installed.granted, strings(&["ui:notify"]));
    assert!(root.path().join("acme.hello/0.1.0/dist/index.js").is_file());
    assert!(!root.path().join(STAGING_DIR).join(&staged.stage_id).exists());

    let reg = registry::load(root.path()).unwrap().registry;
    let entry = &reg.extensions[ID];
    assert_eq!(entry.active, "0.1.0");
    assert!(entry.current.entry_sha512.starts_with("sha512-"));
    assert!(matches!(&entry.current.source, Source::Bundle { sha512, .. } if *sha512 == staged.sha512));

    let listed = install::list(&state).unwrap();
    assert!(!listed.safe_mode);
    assert_eq!(listed.extensions.len(), 1);
    assert_eq!(listed.extensions[0].manifest["version"], "0.1.0");

    // A stage is consumed by confirm.
    assert!(matches!(
        install::confirm_install(&state, &staged.stage_id, &[]),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn confirm_with_missing_grants_fails() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let path = write(files.path(), "h.tgz", &extension(ID, "0.1.0", &["ui:notify", "network:api.acme.dev"]));
    let staged = install::stage_bundle(&state, &path).unwrap();
    let err = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify"])).unwrap_err();
    assert!(matches!(err, Error::Denied(_)), "{err}");
    assert!(!root.path().join(ID).exists());
    // The stage survives a refused confirm, so the dialog can retry.
    let installed = install::confirm_install(
        &state,
        &staged.stage_id,
        &strings(&["network:api.acme.dev", "ui:notify", "tools"]),
    )
    .unwrap();
    // Grants beyond the request are never stored.
    assert_eq!(installed.granted, strings(&["ui:notify", "network:api.acme.dev"]));
}

#[test]
fn an_invalid_manifest_is_refused_at_stage_time() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let mut pkg = package_json(ID, "0.1.0", &["ui:notify"]);
    pkg["jan"]["main"] = serde_json::json!("dist/missing.js");
    let pkg = serde_json::to_vec(&pkg).unwrap();
    let path = write(files.path(), "h.tgz", &tgz(&[("package.json", &pkg)]));
    assert!(matches!(install::stage_bundle(&state, &path), Err(Error::Manifest(_))));
    let staging = root.path().join(STAGING_DIR);
    assert!(fs::read_dir(&staging).map(|d| d.count()).unwrap_or(0) == 0);

    let mut pkg = package_json(ID, "0.1.0", &["ui:notify"]);
    pkg["engines"]["jan"] = serde_json::json!(">=9.0.0");
    let pkg = serde_json::to_vec(&pkg).unwrap();
    let path = write(files.path(), "h2.tgz", &tgz(&[("package.json", &pkg), ("dist/index.js", b"x")]));
    assert!(matches!(install::stage_bundle(&state, &path), Err(Error::Manifest(_))));
}

#[test]
fn an_update_computes_the_permission_diff_and_keeps_one_previous() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["ui:notify", "tools"]);

    let path = write(files.path(), "u.tgz", &extension(ID, "0.2.0", &["ui:notify", "network:api.acme.dev"]));
    let staged = install::stage_bundle(&state, &path).unwrap();
    let existing = staged.existing.clone().unwrap();
    assert_eq!(existing.version, "0.1.0");
    assert_eq!(existing.granted, strings(&["ui:notify", "tools"]));
    assert_eq!(
        staged.permission_diff,
        PermissionDiff { added: strings(&["network:api.acme.dev"]), removed: strings(&["tools"]) }
    );
    let installed = install::confirm_install(
        &state,
        &staged.stage_id,
        &strings(&["ui:notify", "network:api.acme.dev"]),
    )
    .unwrap();
    assert_eq!(installed.version, "0.2.0");
    assert_eq!(installed.previous.as_deref(), Some("0.1.0"));

    install_version(&state, files.path(), "0.3.0", &["ui:notify"]);
    let mut versions: Vec<String> = fs::read_dir(root.path().join(ID))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    versions.sort();
    assert_eq!(versions, vec!["0.2.0", "0.3.0"]);
}

#[test]
fn a_downgrade_or_reinstall_goes_through_rollback_only() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.2.0", &["ui:notify"]);
    for version in ["0.1.0", "0.2.0"] {
        let path = write(files.path(), &format!("d{version}.tgz"), &extension(ID, version, &["ui:notify"]));
        let staged = install::stage_bundle(&state, &path).unwrap();
        let err = install::confirm_install(&state, &staged.stage_id, &strings(&["ui:notify"])).unwrap_err();
        assert!(matches!(err, Error::Denied(_)), "{err}");
    }
    assert_eq!(install::list(&state).unwrap().extensions[0].version, "0.2.0");
}

#[test]
fn rollback_swaps_active_and_previous() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["ui:notify"]);
    assert!(matches!(install::rollback(&state, ID), Err(Error::NotFound(_))));

    install_version(&state, files.path(), "0.2.0", &["ui:notify", "tools"]);
    let rolled = install::rollback(&state, ID).unwrap();
    assert_eq!(rolled.version, "0.1.0");
    assert_eq!(rolled.previous.as_deref(), Some("0.2.0"));
    // Grants shrink to what the restored version requests.
    assert_eq!(rolled.granted, strings(&["ui:notify"]));
    assert!(install::read_entry(&state, ID).unwrap().code.contains("0.1.0"));

    let back = install::rollback(&state, ID).unwrap();
    assert_eq!(back.version, "0.2.0");
    assert!(install::read_entry(&state, ID).unwrap().code.contains("0.2.0"));
}

#[test]
fn uninstall_removes_the_directory_and_entry() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["ui:notify"]);
    install::uninstall(&state, ID).unwrap();
    assert!(!root.path().join(ID).exists());
    assert!(install::list(&state).unwrap().extensions.is_empty());
    assert!(matches!(install::uninstall(&state, ID), Err(Error::NotFound(_))));
    assert!(matches!(install::uninstall(&state, "../x"), Err(Error::Invalid(_))));
}

#[test]
fn set_grants_may_only_revoke() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["ui:notify", "tools"]);
    assert!(matches!(
        install::set_grants(&state, ID, &strings(&["ui:notify", "tools", "network:*"])),
        Err(Error::Denied(_))
    ));
    install::set_grants(&state, ID, &strings(&["tools"])).unwrap();
    assert_eq!(install::list(&state).unwrap().extensions[0].granted, strings(&["tools"]));
}

#[test]
fn read_entry_refuses_when_disabled_in_safe_mode_or_modified() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["ui:notify"]);

    let entry = install::read_entry(&state, ID).unwrap();
    assert!(entry.code.starts_with("var JanExtension"));
    assert_eq!(entry.sha512, registry::load(root.path()).unwrap().registry.extensions[ID].current.entry_sha512);

    install::set_enabled(&state, ID, false).unwrap();
    assert!(matches!(install::read_entry(&state, ID), Err(Error::Denied(_))));
    install::set_enabled(&state, ID, true).unwrap();

    install::set_safe_mode(&state, true).unwrap();
    let listed = install::list(&state).unwrap();
    assert!(listed.safe_mode && !listed.safe_mode_forced);
    assert!(matches!(install::read_entry(&state, ID), Err(Error::Denied(_))));
    install::set_safe_mode(&state, false).unwrap();
    assert!(install::read_entry(&state, ID).is_ok());

    fs::write(root.path().join("acme.hello/0.1.0/dist/index.js"), "var JanExtension = evil").unwrap();
    assert!(matches!(install::read_entry(&state, ID), Err(Error::Tampered(_))));
}

#[test]
fn forced_safe_mode_cannot_be_turned_off() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    install_version(&common::state(root.path()), files.path(), "0.1.0", &["ui:notify"]);
    let forced = ExtensionsState::new(
        root.path(),
        Options { app_version: APP_VERSION.into(), safe_mode_forced: true },
    )
    .unwrap();
    install::set_safe_mode(&forced, false).unwrap();
    let listed = install::list(&forced).unwrap();
    assert!(listed.safe_mode && listed.safe_mode_forced);
    assert!(matches!(install::read_entry(&forced, ID), Err(Error::Denied(_))));
}

#[test]
fn staging_is_wiped_on_init() {
    let root = tempfile::tempdir().unwrap();
    let leftover = root.path().join(STAGING_DIR).join("old");
    fs::create_dir_all(&leftover).unwrap();
    fs::write(leftover.join("package.json"), "{}").unwrap();
    let _state = common::state(root.path());
    assert!(!root.path().join(STAGING_DIR).exists());
}

#[test]
fn discard_stage_removes_its_files() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let path = write(files.path(), "h.tgz", &extension(ID, "0.1.0", &[]));
    let staged = install::stage_bundle(&state, &path).unwrap();
    install::discard_stage(&state, &staged.stage_id).unwrap();
    assert!(!root.path().join(STAGING_DIR).join(&staged.stage_id).exists());
    assert!(matches!(install::discard_stage(&state, &staged.stage_id), Err(Error::NotFound(_))));
}

#[test]
fn a_corrupt_registry_is_reported_by_list() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("extensions.json"), "garbage").unwrap();
    let state = state(root.path());
    let listed = install::list(&state).unwrap();
    assert!(listed.extensions.is_empty());
    assert!(listed.recovered_from.unwrap().contains("extensions.json.corrupt-"));
}

#[test]
fn http_fetch_denies_an_ungranted_host_before_any_network() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:api.acme.dev"]);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    // Unroutable names: a request that got past the check would fail with
    // Network, not Denied.
    for url in [
        "https://evil.invalid/",
        "http://api.acme.dev/",
        "http://127.0.0.1:9/",
    ] {
        let req = HttpRequest { url: url.into(), ..HttpRequest::default() };
        let err = rt.block_on(http::http_fetch(&state, ID, "r1", &req)).unwrap_err();
        assert!(matches!(err, Error::Denied(_)), "{url}: {err}");
    }
    // Revoked grants apply to the next request.
    install::set_grants(&state, ID, &[]).unwrap();
    let req = HttpRequest { url: "https://api.acme.dev/".into(), ..HttpRequest::default() };
    assert!(matches!(rt.block_on(http::http_fetch(&state, ID, "r2", &req)), Err(Error::Denied(_))));
    // An extension that is not installed, or disabled, gets nothing.
    assert!(matches!(rt.block_on(http::http_fetch(&state, "acme.other", "r3", &req)), Err(Error::NotFound(_))));
}

/// Serves one canned HTTP response on 127.0.0.1 and returns the port and
/// the request it read.
async fn serve_once(response: &'static [u8]) -> (u16, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await.unwrap();
        socket.write_all(response).await.unwrap();
        socket.shutdown().await.ok();
        String::from_utf8_lossy(&buf[..n]).into_owned()
    });
    (port, handle)
}

#[test]
fn http_fetch_returns_redirects_and_drops_cookies() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:127.0.0.1"]);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let (port, server) = serve_once(
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1337/v1/chat\r\nSet-Cookie: s=1\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        let mut req = HttpRequest { url: format!("http://127.0.0.1:{port}/x"), ..HttpRequest::default() };
        req.headers.insert("Cookie".into(), "jar=1".into());
        req.headers.insert("Authorization".into(), "Bearer k".into());
        let response = http::http_fetch(&state, ID, "r", &req).await.unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(response.headers["location"], "http://127.0.0.1:1337/v1/chat");
        assert!(!response.headers.contains_key("set-cookie"));
        let seen = server.await.unwrap().to_ascii_lowercase();
        assert!(!seen.contains("cookie"), "{seen}");
        assert!(seen.contains("authorization: bearer k"));
    });
}

#[test]
fn http_fetch_caps_the_body() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:localhost"]);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        static BIG: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
        let body = BIG.get_or_init(|| {
            let mut r = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", http::MAX_RESPONSE_BYTES + 1).into_bytes();
            r.extend(vec![b'a'; http::MAX_RESPONSE_BYTES + 1]);
            r
        });
        let (port, _server) = serve_once(body).await;
        let req = HttpRequest { url: format!("http://localhost:{port}/"), ..HttpRequest::default() };
        let err = http::http_fetch(&state, ID, "r", &req).await.unwrap_err();
        assert!(matches!(err, Error::TooLarge(_)), "{err}");
    });
}

#[test]
fn http_fetch_refuses_the_local_api_port() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:127.0.0.1"]);
    state.set_local_api_port(Some(1337));
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let req = HttpRequest { url: "http://127.0.0.1:1337/v1/models".into(), ..HttpRequest::default() };
    assert!(matches!(rt.block_on(http::http_fetch(&state, ID, "r", &req)), Err(Error::Denied(_))));
}

#[test]
fn http_fetch_stream_delivers_head_chunks_and_end() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:127.0.0.1"]);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let (port, _server) = serve_once(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n6\r\ndata: \r\n7\r\nhello\n\n\r\n0\r\n\r\n",
        )
        .await;
        let req = HttpRequest { url: format!("http://127.0.0.1:{port}/sse"), ..HttpRequest::default() };
        let mut events = Vec::new();
        let status = http::http_fetch_stream(&state, ID, "s", &req, |e| {
            events.push(e);
            true
        })
        .await
        .unwrap();
        assert_eq!(status, 200);
        assert!(matches!(&events[0], HttpStreamEvent::Head { status: 200, headers } if headers["content-type"] == "text/event-stream"));
        assert_eq!(events.last(), Some(&HttpStreamEvent::End));
        let body: String = events
            .iter()
            .filter_map(|e| match e {
                HttpStreamEvent::Chunk { data } => Some(data.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(body, "data: hello\n\n");
    });
}

#[test]
fn http_fetch_can_be_cancelled() {
    let root = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let state = state(root.path());
    install_version(&state, files.path(), "0.1.0", &["network:127.0.0.1"]);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        // Accepts and never answers.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let _hold = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        let req = HttpRequest { url: format!("http://127.0.0.1:{port}/"), ..HttpRequest::default() };
        let fetch = http::http_fetch(&state, ID, "slow", &req);
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            http::cancel(&state, ID, "slow");
        };
        let (result, ()) = tokio::join!(fetch, cancel);
        assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    });
}
