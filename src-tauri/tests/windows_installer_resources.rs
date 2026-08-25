//! Guards the one file that silently drops bundled resources.
//!
//! `template-tauri-build-windows-x64.yml` patches
//! `bundle.windows.nsis.template` into the config at build time, so the NSIS
//! bundler stops deriving its resource list from `bundle.resources` and uses the
//! committed template's hand-written block instead. The MSI still honours the
//! config, so a resource missing from the template ships in the MSI and not in
//! the setup exe -- which is the primary release asset *and* the auto-updater
//! payload, making it the more damaging half.
//!
//! This has already happened twice: #7618 hand-added `jan-cli.exe`, and the
//! engine worker plus its ggml modules fell through the same gap. Nothing in the
//! build fails when it happens, which is why it needs a test rather than a
//! comment.

use std::path::PathBuf;

fn repo_file(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()))
}

#[test]
fn every_bundled_windows_resource_is_installed_by_the_nsis_template() {
    let conf: serde_json::Value = serde_json::from_str(&repo_file("tauri.windows.conf.json"))
        .expect("tauri.windows.conf.json is not valid JSON");
    let resources = conf["bundle"]["resources"]
        .as_array()
        .expect("bundle.resources must be an array");
    assert!(
        !resources.is_empty(),
        "bundle.resources is empty; this test would then assert nothing"
    );

    let template = repo_file("tauri.bundle.windows.nsis.template");

    let missing: Vec<&str> = resources
        .iter()
        .filter_map(|r| r.as_str())
        // The basename is what the template writes, and it carries the glob
        // verbatim (`ggml*.dll`), so comparing basenames covers both the literal
        // and the wildcard entries without reimplementing glob matching.
        .filter(|rel| {
            let name = rel.rsplit('/').next().unwrap_or(rel);
            !template.contains(name)
        })
        .collect();

    assert!(
        missing.is_empty(),
        "these bundle.resources entries are declared in tauri.windows.conf.json \
         but never installed by tauri.bundle.windows.nsis.template, so they ship \
         in the MSI and are silently absent from the NSIS setup exe: {missing:?}\n\
         Add a `File` line for each to the template's `; Copy resources` block."
    );
}
