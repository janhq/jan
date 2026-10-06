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

/// The body of `Function <name>` or `Section <name>` up to its terminator.
///
/// Located by byte search rather than by summing line lengths: a Windows
/// checkout has CRLF endings, which `lines()` strips without saying how many
/// bytes it dropped.
fn nsis_block<'a>(template: &'a str, opener: &str, end: &str) -> &'a str {
    let offset = template
        .match_indices(opener)
        .map(|(i, _)| i)
        .find(|&i| {
            let at_line_start = i == 0 || template.as_bytes()[i - 1] == b'\n';
            let after = &template[i + opener.len()..];
            at_line_start && after.trim_start_matches([' ', '\t']).starts_with(['\r', '\n'])
        })
        .unwrap_or_else(|| panic!("`{opener}` not found in the NSIS template"));
    let rest = &template[offset..];
    let stop = rest
        .find(end)
        .unwrap_or_else(|| panic!("`{opener}` has no `{end}`"));
    &rest[..stop]
}

/// The shortcut retarget on a main-binary rename (`jan.exe` -> `Jan-Desktop.exe`
/// in 0.8.5, #9125) needs the previous name from the uninstall key. A passive
/// upgrade runs the old uninstaller from `PageLeaveReinstall`, which deletes that
/// key before `Section Install` runs, so the name has to be captured in
/// `.onInit`, while the key still exists. Reading it in `Section Install` finds
/// nothing and leaves every shortcut pointing at the deleted exe.
#[test]
fn the_previous_main_binary_name_is_read_before_the_old_uninstaller_runs() {
    let template = repo_file("tauri.bundle.windows.nsis.template");
    let read = "ReadRegStr $OldMainBinaryName SHCTX \"${UNINSTKEY}\" \"MainBinaryName\"";

    let on_init = nsis_block(&template, "Function .onInit", "FunctionEnd");
    let read_at = on_init
        .find(read)
        .expect("`.onInit` must read MainBinaryName into $OldMainBinaryName");
    // SHCTX names a hive only once MULTIUSER_INIT has picked the install mode
    // (INSTALLMODE "both"); read before it, the lookup can hit the wrong hive.
    let context_at = on_init
        .find("!insertmacro MULTIUSER_INIT")
        .expect("`.onInit` no longer calls MULTIUSER_INIT; re-check where SHCTX is set");
    assert!(
        read_at > context_at,
        "`.onInit` must read MainBinaryName after MULTIUSER_INIT sets SHCTX"
    );

    let install = nsis_block(&template, "Section Install", "SectionEnd");
    assert!(
        !install.contains("ReadRegStr $OldMainBinaryName"),
        "`Section Install` must not re-read MainBinaryName: by then a passive \
         upgrade has run the old uninstaller, which deleted the key"
    );
    assert!(
        install.contains("WriteRegStr SHCTX \"${UNINSTKEY}\" \"MainBinaryName\""),
        "`Section Install` must still record MainBinaryName for the next update"
    );
}

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
