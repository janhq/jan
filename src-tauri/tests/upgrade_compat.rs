//! Upgrade-path compatibility: data written by past releases must stay
//! readable by current code.
//!
//! Everything under `tests/fixtures/upgrade/` is real bytes written by the
//! named release (0.8.3 stable on Windows for `store.json` and
//! `mcp_config.json`, 0.8.3 stable on macOS for the thread files), committed
//! so a schema drift that would silently eat user data fails here instead of
//! on a user machine. Threads are plain per-thread JSON/JSONL files; the store
//! marks the MCP schema version (3 on 0.8.3, 4 from 0.8.4) that
//! `core/setup.rs migrate_mcp_servers` migrates against.
//!
//! When a release intentionally changes one of these schemas, commit the old
//! release's output as a new fixture directory under
//! `tests/fixtures/upgrade/<release>/` and add assertions for it (pass that
//! directory to `fixture_root`); update an existing fixture only when the
//! current schema itself is being pinned, never to make a test pass.

// `core::setup` is desktop-only -- `core/mod.rs` gates it out of
// `--features cli`, which builds this test target too. The fixtures are
// desktop data folders, so the suite belongs to the desktop build.
#![cfg(not(feature = "cli"))]

use app_lib::core::mcp::models::McpSettings;
use app_lib::core::setup::{is_default_exa_server, CURRENT_MCP_SCHEMA_VERSION};
use app_lib::core::threads::helpers::read_messages_from_file;
use app_lib::core::threads::utils::{get_messages_path, get_thread_dir, get_thread_metadata_path};
use serde_json::Value;
use std::path::PathBuf;

/// Root of a committed release data-folder fixture. Mirrors the layout of
/// `~/Library/Application Support/Jan/data` (macOS) / `%APPDATA%\Jan\data`
/// (Windows): `threads/<id>/{thread.json,messages.jsonl}`, `store.json`,
/// `mcp_config.json`.
fn fixture_root(release: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/upgrade")
        .join(release)
}

/// Every committed release fixture, oldest first. Discovered rather than
/// listed because the tripwire below exists to demand a new fixture on a
/// schema bump -- if it also demanded an edit here, the edit is the thing that
/// would get forgotten.
fn fixture_releases() -> Vec<String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/upgrade");
    let mut releases: Vec<(Vec<u64>, String)> = std::fs::read_dir(&root)
        .unwrap_or_else(|e| panic!("upgrade fixture root {root:?} unreadable: {e}"))
        .map(|entry| entry.expect("fixture directory entry must be readable"))
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Sort on the parsed components, not the string: "0.8.10" must
            // come after "0.8.9", which it does not lexicographically.
            let parts = name
                .split('.')
                .map(|part| {
                    part.parse().unwrap_or_else(|_| {
                        panic!("fixture directory {name:?} is not a dotted release version")
                    })
                })
                .collect();
            (parts, name)
        })
        .collect();
    assert!(
        !releases.is_empty(),
        "no release fixtures under {root:?} -- this suite would pass vacuously"
    );
    releases.sort();
    releases.into_iter().map(|(_, name)| name).collect()
}

/// `mcp_version` from a release fixture's `store.json`, checking on the way
/// that the directory name and the release the store records agree.
fn fixture_mcp_version(release: &str) -> i64 {
    let path = fixture_root(release).join("store.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{release} store.json fixture missing at {path:?}: {e}"));
    let store: Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("{release} store.json must parse: {e}"));
    assert_eq!(
        store["version"].as_str(),
        Some(release),
        "fixture directory {release} holds a store.json written by a different release"
    );
    store["mcp_version"].as_i64().unwrap_or(0)
}

fn read_thread_metadata(release: &str, thread_id: &str) -> Value {
    let path = get_thread_metadata_path(&fixture_root(release), thread_id);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{release} thread metadata {path:?} unreadable: {e}"));
    serde_json::from_str(&raw).expect("thread.json must parse as JSON")
}

fn read_all_messages(release: &str, thread_id: &str) -> Vec<Value> {
    // The reader returns Ok(vec![]) for a missing file, which would turn a
    // layout-constant drift into a confusing downstream length failure —
    // assert the resolved path exists first so the cause is named.
    let path = get_messages_path(&fixture_root(release), thread_id);
    assert!(
        path.exists(),
        "{release} messages file missing at {path:?} — layout constant drifted"
    );
    read_messages_from_file(&fixture_root(release), thread_id)
        .unwrap_or_else(|e| panic!("{release} messages for {thread_id} failed to parse: {e}"))
}

#[test]
fn threads_written_by_0_8_3_resolve_and_parse() {
    let thread_ids = [
        "1fa772e9-47e5-4a8c-a664-4b1cef37c5aa",
        "784952d3-dc72-474e-ab24-0d78e7035280",
    ];
    for id in thread_ids {
        let dir = get_thread_dir(&fixture_root("0.8.3"), id);
        assert!(dir.is_dir(), "0.8.3 thread dir {id} missing from fixtures");
        let metadata = read_thread_metadata("0.8.3", id);
        assert_eq!(
            metadata["object"], "thread",
            "0.8.3 thread.json lost its `object` discriminator"
        );
        assert!(
            metadata["title"].is_string(),
            "0.8.3 thread.json lost its `title`"
        );
        assert!(
            !metadata["assistants"]
                .as_array()
                .expect("assistants")
                .is_empty(),
            "0.8.3 thread.json carried a default assistant; schema must keep parsing it"
        );
    }
}

#[test]
fn messages_written_by_0_8_3_round_trip_through_the_current_reader() {
    // Seeded during the 0.8.3 QA run: user message plus the mock provider's
    // reply. Both turns must survive the current JSONL reader.
    let messages = read_all_messages("0.8.3", "784952d3-dc72-474e-ab24-0d78e7035280");
    assert!(
        messages.len() >= 2,
        "0.8.3 thread should have at least a user and an assistant turn"
    );
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[1]["role"], "assistant");
    // 0.8.3 content shape: content[0] = {type: "text", text: {value: "..."}}.
    let user_text = messages[0]["content"][0]["text"]["value"]
        .as_str()
        .expect("0.8.3 user message text must be readable");
    assert!(
        user_text.contains("QA thread 1"),
        "0.8.3 message content drifted: {user_text}"
    );
}

#[test]
fn thread_dir_layout_matches_current_path_resolution() {
    // get_thread_dir/get_messages_path are what every reader resolves through;
    // if the layout constants drift (e.g. `threads` renamed), this fails.
    let id = "1fa772e9-47e5-4a8c-a664-4b1cef37c5aa";
    assert!(get_thread_dir(&fixture_root("0.8.3"), id).is_dir());
    let messages = read_all_messages("0.8.3", id);
    assert!(
        !messages.is_empty(),
        "0.8.3 messages must not read as empty"
    );
}

#[test]
fn every_store_fixture_sits_inside_the_migration_range() {
    let releases = fixture_releases();

    // `migrate_mcp_servers` (core/setup.rs) only walks stores *below*
    // CURRENT_MCP_SCHEMA_VERSION through the gates, so a fixture at or above it
    // would sit outside the migration path this suite exists to cover and
    // assert nothing.
    for release in &releases {
        let mcp_version = fixture_mcp_version(release);
        assert!(
            mcp_version < CURRENT_MCP_SCHEMA_VERSION,
            "{release} fixture carries mcp_version {mcp_version}, which the current schema \
             ({CURRENT_MCP_SCHEMA_VERSION}) no longer migrates"
        );
    }

    // The newest fixture is pinned at exactly CURRENT - 1, and that is the
    // whole point of this test. `<` is satisfied by 3 < 5 just as well as by
    // 3 < 4, so it would stay green through a schema bump and guard nothing --
    // it only ever fired if the constant were *lowered*. Pinning the gap at
    // exactly one release means bumping the constant fails here until the
    // newly-superseded release's store output is committed as a fixture, which
    // is the coverage this file exists to keep.
    let newest = releases
        .last()
        .expect("fixture_releases rejects an empty set");
    let newest_version = fixture_mcp_version(newest);
    assert_eq!(
        newest_version,
        CURRENT_MCP_SCHEMA_VERSION - 1,
        "the newest upgrade fixture ({newest}) carries mcp_version {newest_version}, but the \
         current schema is {CURRENT_MCP_SCHEMA_VERSION}. If you just bumped \
         CURRENT_MCP_SCHEMA_VERSION, commit the store.json written by the release that shipped \
         schema {} as a new fixture directory under tests/fixtures/upgrade/.",
        CURRENT_MCP_SCHEMA_VERSION - 1
    );
}

#[test]
fn mcp_config_written_by_0_8_3_parses_with_current_settings_schema() {
    let raw = std::fs::read_to_string(fixture_root("0.8.3").join("mcp_config.json"))
        .expect("0.8.3 mcp_config.json fixture missing");
    let config: Value = serde_json::from_str(&raw).expect("0.8.3 mcp_config.json must parse");

    // `mcpSettings` (0.8.3) deserializes into the current typed settings.
    let settings: McpSettings = serde_json::from_value(config["mcpSettings"].clone())
        .expect("0.8.3 mcpSettings must deserialize into the current McpSettings schema");
    assert_eq!(settings.tool_call_timeout_seconds, 30);
    assert_eq!(settings.backoff_multiplier, 2.0);

    // Those two asserts cannot catch a renamed key, which is what makes the
    // synthetic case below necessary rather than belt-and-braces. 0.8.3 stored
    // the shipped defaults, and every McpSettings field carries
    // `#[serde(default)]`, so a rename degrades to a value identical to the one
    // the fixture holds and both asserts above stay green.
    //
    // Non-default values keyed by the same names do bite: if
    // `toolCallTimeoutSeconds` or `backoffMultiplier` is renamed, these fall
    // back to 30 and 2.0 and fail.
    let renamed_probe: McpSettings = serde_json::from_value(serde_json::json!({
        "toolCallTimeoutSeconds": 90,
        "backoffMultiplier": 3.5,
    }))
    .expect("the current McpSettings schema must accept 0.8.3's camelCase keys");
    assert_eq!(
        renamed_probe.tool_call_timeout_seconds, 90,
        "toolCallTimeoutSeconds no longer maps onto tool_call_timeout_seconds"
    );
    assert_eq!(
        renamed_probe.backoff_multiplier, 3.5,
        "backoffMultiplier no longer maps onto backoff_multiplier"
    );

    // Migration 4 removes only an exa entry that is inactive *and* keyless.
    //
    // What the fixture actually is, stated carefully because the obvious
    // reading is wrong: 0.8.3's own `migrate_exa_to_http` wrote this entry with
    // `active: true` (`git show v0.8.3:src-tauri/src/core/setup.rs`), so it is
    // byte-for-byte 0.8.3's *default*, not evidence that a user activated
    // anything. The contract pinned below is therefore "an exa entry as 0.8.3
    // left it survives the 0.8.4 cutover" -- true precisely because 0.8.3's
    // default is active.
    //
    // That is recorded as current behaviour, not endorsed: 0.8.3 wrote this
    // shape for every user, so the cutover is close to a no-op for the whole
    // 0.8.3 population. Widening it is a separate change against the shipping
    // migration -- see janhq/jan#9010 and the note on `remove_exa_server`.
    // If that widening lands, this assertion is expected to flip, and
    // flipping it is the signal that the behaviour changed rather than a
    // regression.
    let servers = config["mcpServers"].as_object().expect("mcpServers object");
    let fixture_exa = servers
        .get("exa")
        .expect("0.8.3 config carried an exa entry");
    assert!(
        !is_default_exa_server(fixture_exa),
        "an exa entry as 0.8.3 wrote it must not be classified as the removable default"
    );
    let untouched_default = serde_json::json!({
        "type": "http",
        "url": "https://mcp.exa.ai/mcp",
        "command": "",
        "args": [],
        "env": {},
        "active": false
    });
    assert!(
        is_default_exa_server(&untouched_default),
        "the never-activated default exa entry is what migration 4 removes"
    );
}
