//! End-to-end smoke install of a real packed extension (the sample bundle).
//!
//! Ignored by default: `scripts/extensions-smoke.mjs` (`make
//! test-extensions-smoke`) packs the sample and runs it with
//! `JAN_EXT_SMOKE_TGZ` (the `.tgz` to install) and `JAN_EXT_SMOKE_ROOT` (an
//! empty extensions root it leaves installed for the web-app half of the
//! smoke test to load).

use std::path::PathBuf;

use serde_json::Value;
use tauri_plugin_extensions::install;
use tauri_plugin_extensions::integrity::sha512_sri;
use tauri_plugin_extensions::registry::{self, Source};
use tauri_plugin_extensions::state::{ExtensionsState, Options};

fn env_path(name: &str) -> PathBuf {
    match std::env::var_os(name) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => panic!("{name} is not set; run this test through `make test-extensions-smoke`"),
    }
}

/// The app version the desktop build reports, so `engines.jan` is checked
/// against the real app rather than a test constant.
fn app_version() -> String {
    let conf = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tauri.conf.json"))
        .expect("read src-tauri/tauri.conf.json");
    let conf: Value = serde_json::from_str(&conf).expect("parse tauri.conf.json");
    conf["version"].as_str().expect("tauri.conf.json has a version").to_string()
}

#[test]
#[ignore = "needs JAN_EXT_SMOKE_TGZ and JAN_EXT_SMOKE_ROOT; run `make test-extensions-smoke`"]
fn installs_the_packed_sample() {
    let tgz = env_path("JAN_EXT_SMOKE_TGZ");
    let root = env_path("JAN_EXT_SMOKE_ROOT");
    assert!(tgz.is_file(), "{} is not a file", tgz.display());
    let state = ExtensionsState::new(
        &root,
        Options {
            app_version: app_version(),
            safe_mode_forced: false,
        },
    )
    .expect("open the extensions root");

    let tarball = std::fs::read(&tgz).expect("read the tarball");
    let staged = install::stage_bundle(&state, &tgz).expect("stage the bundle");
    assert!(!staged.verified, "a bundle from disk is never verified");
    assert!(!staged.integrity_checked);
    assert_eq!(staged.sha512, sha512_sri(&tarball));
    assert!(staged.existing.is_none());
    let id = staged.manifest["jan"]["id"].as_str().expect("jan.id").to_string();
    let version = staged.manifest["version"].as_str().expect("version").to_string();
    let requested: Vec<String> = staged.manifest["jan"]["permissions"]
        .as_array()
        .expect("jan.permissions")
        .iter()
        .map(|p| p.as_str().expect("permission string").to_string())
        .collect();
    assert_eq!(staged.permission_diff.added, requested);
    assert!(staged.permission_diff.removed.is_empty());

    let installed = install::confirm_install(&state, &staged.stage_id, &requested).expect("confirm");
    assert_eq!(installed.id, id);
    assert_eq!(installed.version, version);
    assert!(installed.enabled);
    assert_eq!(installed.granted, requested);

    let entry = install::read_entry(&state, &id).expect("read_entry");
    assert!(entry.code.starts_with("var JanExtension"), "not the sample's IIFE bundle");

    let reg = registry::load(&root).expect("load the registry").registry;
    let record = &reg.extensions[&id];
    assert_eq!(record.active, version);
    assert!(record.enabled);
    assert_eq!(record.granted, requested);
    assert_eq!(record.current.entry_sha512, entry.sha512);
    assert_eq!(record.current.entry_sha512, sha512_sri(entry.code.as_bytes()));
    let file_name = tgz.file_name().unwrap().to_string_lossy().into_owned();
    assert_eq!(
        record.current.source,
        Source::Bundle { file_name, sha512: staged.sha512.clone() }
    );
    assert!(!reg.safe_mode);

    let listed = install::list(&state).expect("list");
    assert_eq!(listed.extensions.len(), 1);
    assert_eq!(listed.extensions[0].manifest, staged.manifest);
}
