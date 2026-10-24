//! Builds extension tarballs in-test.

use std::io::Write;
use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::{json, Value};
use tar::{Builder, EntryType, Header};
use tauri_plugin_extensions::state::{ExtensionsState, Options};

/// The app version the tests run as.
pub const APP_VERSION: &str = "0.8.5";

/// A package.json for `id@version` requesting `permissions`.
pub fn package_json(id: &str, version: &str, permissions: &[&str]) -> Value {
    json!({
        "name": format!("@test/{}", id.replace('.', "-")),
        "version": version,
        "engines": { "jan": ">=0.8.0" },
        "jan": {
            "id": id,
            "displayName": "Test",
            "publisher": "Test",
            "apiVersion": "^0.1.0",
            "main": "dist/index.js",
            "permissions": permissions,
        }
    })
}

/// A gzipped npm-style tarball of `files` under `package/`.
pub fn tgz(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = Builder::new(Vec::new());
    for (path, data) in files {
        let mut header = Header::new_ustar();
        header.set_entry_type(EntryType::Regular);
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        header.set_path(format!("package/{path}")).unwrap();
        header.set_cksum();
        builder.append(&header, *data).unwrap();
    }
    let tar = builder.into_inner().unwrap();
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&tar).unwrap();
    gz.finish().unwrap()
}

/// A tarball of a valid extension.
pub fn extension(id: &str, version: &str, permissions: &[&str]) -> Vec<u8> {
    let pkg = serde_json::to_vec(&package_json(id, version, permissions)).unwrap();
    let code = format!("var JanExtension = {{ version: '{version}' }}");
    tgz(&[("package.json", &pkg), ("dist/index.js", code.as_bytes())])
}

/// Writes `bytes` to `<dir>/<name>` and returns the path.
pub fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

/// A state over `root`, safe mode off.
pub fn state(root: &Path) -> ExtensionsState {
    ExtensionsState::new(
        root,
        Options {
            app_version: APP_VERSION.into(),
            safe_mode_forced: false,
        },
    )
    .unwrap()
}

/// Strings from string slices.
pub fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}
