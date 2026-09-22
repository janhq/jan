//! The protocol as a JSON Schema document, derived from the types themselves.
//!
//! Every consumer of this channel -- the ACP adapter (#347), the SDKs, any
//! client -- otherwise re-declares what it reads and writes. A re-declaration is
//! correct until the types move, and nothing says when they did. `jan cli agent
//! schema` publishes what the types say instead, and the committed copy is
//! diffed in CI, so a schema-affecting change cannot land without the file
//! moving with it.
//!
//! The document has two root properties:
//!
//! - `output`: the records a run writes to stdout, in the order they can appear;
//! - `input`: the lines a client may write to stdin.
//!
//! Determinism is a requirement rather than a nicety: the file is committed and
//! CI fails on a diff, so regenerating an unchanged protocol has to be
//! byte-identical. What that rests on:
//!
//! - **Order** comes from the declarations. Variants appear in the order the
//!   enums declare them and fields in the order the structs do; object keys are
//!   sorted by `serde_json`, which is also what prints every other JSON artifact
//!   here. Nothing iterates a hash map on the way out, and a test regenerates
//!   twice in one process to say so.
//! - **Doc comments are part of the document**: `schemars` turns each one into
//!   the `description` of the type, variant or field it documents. Rewording a
//!   comment on a protocol type is a schema change, and the guard treats it as
//!   one -- which is the intended reading, since that prose is what a consumer
//!   reading the schema has instead of the Rust source.
//! - **The draft** is whatever `schemars` emits, and the document states it in
//!   `$schema` (`draft 2020-12` today). Pinning the string by hand would let the
//!   file claim a draft the generator does not implement; stating what was
//!   generated keeps a draft change a reviewable diff.
//! - **The generator version** is pinned by the committed `Cargo.lock`
//!   (`src-tauri/Cargo.lock`), and CI regenerates with `--locked`. A `schemars`
//!   update that changes the output therefore shows up as a diff to review
//!   rather than as a silently different document. The failure mode is a noisy
//!   pull request, never a wrong artifact.
//!
//! `x-protocol-version` carries [`PROTOCOL_VERSION`]: a consumer pins the
//! contract it validates against, and a schema for a later version is a
//! different file, not a silently wider one.

use std::path::Path;

use crate::core::agent::events::{StreamEvent, PROTOCOL_VERSION};
use crate::core::cli::run_report::{Init, PermissionDecisionRecord, RunResult};
use crate::core::cli::stream_input::{InputErrorRecord, InputLine};

/// The schema of every record a run may write to stdout: the agent loop's own
/// stream, plus the four records the CLI mints around it. `untagged` because
/// this union is not itself on the wire -- each record carries its own `type`.
// Nothing constructs this union: it exists so the schema can name the set, and
// each variant's `JsonSchema` impl is what the document uses.
#[allow(dead_code)]
#[derive(serde::Serialize, schemars::JsonSchema)]
#[serde(untagged)]
#[schemars(description = "Any record a run writes to stdout.")]
enum OutputRecord<'a> {
    Event(StreamEvent),
    Init(Init),
    Result(RunResult),
    PermissionDecision(PermissionDecisionRecord<'a>),
    InputError(InputErrorRecord<'a>),
}

/// The document's root. A struct rather than an assembled object so each
/// direction is described by the type that defines it, and so the schema's own
/// `$defs` name those types.
// Nothing constructs the root either: the two fields are the document's two
// properties, and are read by `schema_for!` rather than by code.
#[allow(dead_code)]
#[derive(schemars::JsonSchema)]
#[schemars(
    title = "Jan agent protocol v1",
    description = "Every record a `jan cli agent run` writes to stdout, and every line a client may write to stdin. The `x-protocol-version` keyword names the contract version this document describes."
)]
struct Protocol<'a> {
    /// Records a run writes to stdout. The first is `init`, and the last is
    /// `result`; everything between them is a `StreamEvent` or a
    /// CLI-minted record.
    output: OutputRecord<'a>,
    /// Lines a client may write to stdin. What this run accepts is reported by
    /// `init`'s `input_kinds`, which is empty when the run reads no stdin.
    input: InputLine,
}

/// The document as a JSON value: `schema_for!`'s root, plus the one keyword
/// schemars does not emit. A custom keyword rather than a `const` on each
/// record's field: it describes the document as a whole, and draft 2020-12
/// ignores keywords it does not know.
fn root() -> serde_json::Value {
    let mut root = serde_json::to_value(schemars::schema_for!(Protocol<'static>))
        .expect("a schema serializes to JSON");
    root.as_object_mut()
        .expect("schemars' root schema is an object")
        .insert(
            "x-protocol-version".to_string(),
            serde_json::json!(PROTOCOL_VERSION),
        );
    root
}

/// The schema document: pretty-printed JSON with a trailing newline, so it
/// diffs as text and ends the way every other file in the tree does.
pub(crate) fn document() -> String {
    let mut text = serde_json::to_string_pretty(&root()).expect("a schema prints as JSON");
    text.push('\n');
    text
}

/// Write the schema to `out`, or print it when there is no file to write.
///
/// `out` is what CI and `make protocol-schema` use, which also keeps cargo's own
/// build noise off stdout.
pub fn run(out: Option<&Path>) -> Result<(), String> {
    let document = document();
    match out {
        Some(path) => std::fs::write(path, document)
            .map_err(|e| format!("could not write {}: {e}", path.display())),
        None => {
            print!("{document}");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed file, which CI diffs against a fresh generation.
    const COMMITTED: &str = include_str!("../../../../protocol/schema.json");

    /// The file is committed, so regenerating an unchanged protocol must not
    /// produce a diff: two runs in one process have to agree, which is also what
    /// rules out iteration over a hash map reaching the output.
    #[test]
    fn regenerating_the_schema_is_byte_identical() {
        assert_eq!(document(), document());
    }

    /// The guard the whole issue is about. Without it the file is a snapshot
    /// that is right on the day it lands.
    #[test]
    fn the_committed_schema_matches_the_types() {
        let generated = document();
        if generated == COMMITTED {
            return;
        }
        let first = generated
            .lines()
            .zip(COMMITTED.lines())
            .position(|(a, b)| a != b)
            .unwrap_or(0);
        panic!(
            "protocol/schema.json no longer matches the protocol types; run \
             `make protocol-schema` and commit the result.\n\
             first difference at line {}:\n  committed: {}\n  generated: {}",
            first + 1,
            COMMITTED.lines().nth(first).unwrap_or("<end of file>"),
            generated.lines().nth(first).unwrap_or("<end of file>"),
        );
    }

    /// The document describes the whole channel and nothing else. A record
    /// family the document omits is a consumer that cannot validate it; a tag it
    /// invents is a promise nothing keeps.
    ///
    /// Both sides are counted against the sources that already define them: the
    /// loop against `sample_events`, which the event tests pin to every declared
    /// variant, and the CLI's own records against instances of those records.
    #[test]
    fn the_document_describes_exactly_the_channel() {
        let json = root();
        let defs = json["$defs"]
            .as_object()
            .expect("derived schemas keep their named types in $defs")
            .clone();

        // Every record a run can print, tagged: 24 loop events plus the four the
        // CLI mints around them.
        let mut documented: Vec<String> = defs["OutputRecord"]["anyOf"]
            .as_array()
            .expect("the output union lists its record families")
            .iter()
            .flat_map(|branch| {
                let name = branch["$ref"]
                    .as_str()
                    .and_then(|r| r.strip_prefix("#/$defs/"))
                    .unwrap_or_else(|| panic!("a record family is not a $ref: {branch}"));
                tagged_consts(&defs[name], name)
            })
            .collect();
        documented.sort();
        documented.dedup();

        let mut emitted: Vec<String> = crate::core::agent::events::tests::sample_events()
            .iter()
            .map(|(name, ev)| {
                serde_json::to_value(ev).unwrap()["type"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{name} has no tag"))
                    .to_string()
            })
            .chain(minted_tags())
            .collect();
        emitted.sort();

        assert_eq!(documented, emitted);

        // Input tags come from the same list `init.input_kinds` advertises, so
        // the document cannot offer a message kind the run refuses.
        let mut documented: Vec<String> = tagged_consts(&defs["InputLine"], "InputLine");
        documented.sort();
        let mut advertised: Vec<String> = crate::core::cli::stream_input::INPUT_KINDS
            .iter()
            .map(|k| k.to_string())
            .collect();
        advertised.sort();
        assert_eq!(documented, advertised);

        assert_eq!(
            json["x-protocol-version"],
            serde_json::json!(PROTOCOL_VERSION)
        );
    }

    /// The four tags the CLI mints around the loop, read off instances of the
    /// records that mint them rather than off their names.
    fn minted_tags() -> Vec<String> {
        use crate::core::cli::run_report::{Init, PermissionDecisionRecord, RunReport};
        use crate::core::cli::stream_input::InputErrorRecord;

        // The envelope is only ever built by `RunReport::finish`, which is what
        // `jan cli agent run` prints: its tag comes from there, not from a name.
        let report = RunReport::default().finish(None, None, "stub-model", 1, None);
        [
            serde_json::to_value(Init::new(
                "session",
                "stub-model",
                None,
                Vec::new(),
                Vec::new(),
            ))
            .unwrap(),
            serde_json::to_value(report).unwrap(),
            serde_json::to_value(PermissionDecisionRecord::new(
                "req",
                tauri_plugin_agent_tools::tools::gate::PermissionDecision::AllowOnce,
            ))
            .unwrap(),
            serde_json::to_value(InputErrorRecord::new("unknown type 'x'", "{}")).unwrap(),
        ]
        .iter()
        .map(|record| {
            record["type"]
                .as_str()
                .unwrap_or_else(|| panic!("a minted record has no tag: {record}"))
                .to_string()
        })
        .collect()
    }

    /// Every `"type": {"const": "..."}` in a schema: how a `#[serde(tag =
    /// "type")]` enum states its variants, and how the CLI's records state the
    /// tag they are built with. A schema with neither is a shape whose
    /// discriminator a consumer cannot switch on, so it is an error rather than
    /// an empty list.
    fn tagged_consts(schema: &serde_json::Value, what: &str) -> Vec<String> {
        if let Some(tag) = schema["properties"]["type"]["const"].as_str() {
            return vec![tag.to_string()];
        }
        let branches = schema["oneOf"]
            .as_array()
            .or_else(|| schema["anyOf"].as_array())
            .unwrap_or_else(|| panic!("{what} has no branches and no tag const"));
        branches
            .iter()
            .map(|branch| {
                branch["properties"]["type"]["const"]
                    .as_str()
                    .unwrap_or_else(|| panic!("a {what} branch has no `type` const: {branch}"))
                    .to_string()
            })
            .collect()
    }
}
