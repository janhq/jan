//! Parsing of the `router.preset.ini` Jan generates.
//!
//! Lives in the library rather than the worker binary because the reload
//! endpoint re-reads the file at runtime, so both the startup path and the
//! HTTP layer need it.

use std::collections::HashMap;

use super::registry::LoadSpec;

/// Section names from a preset. `[*]` is the shared defaults block, not a
/// model, and the C++ loader applies it to every section.
pub fn sections(ini: &str) -> Vec<String> {
    ini.lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix('[')?.strip_suffix(']'))
        .filter(|s| *s != "*")
        .map(str::to_string)
        .collect()
}

/// The body of one section, used to tell a changed model from an unchanged one
/// across a reload. Lines are kept verbatim apart from trimming, so a
/// whitespace-only edit does not look like a settings change.
fn section_bodies(ini: &str) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    let mut current: Option<String> = None;
    for line in ini.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            current = Some(name.to_string());
            out.entry(name.to_string()).or_default();
            continue;
        }
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(name) = &current {
            out.entry(name.clone()).or_default().push(line.to_string());
        }
    }
    out
}

/// A key from the shared `[*]` block.
///
/// Read on the Rust side as well as by the C++ loader because the worker has to
/// act on two of them before any model is loaded: `slot-save-path` names a
/// directory llama.cpp *throws* on if it does not exist
/// (`common/arg.cpp:3635`), and the KV state store has to agree with llama.cpp
/// on where files land.
pub fn shared_value(ini: &str, key: &str) -> Option<String> {
    let mut in_shared = false;
    for line in ini.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_shared = name == "*";
            continue;
        }
        if !in_shared || line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// Whether auto-fit is free to size `section`'s context: fit is on (llama.cpp's
/// default when the preset says nothing) and no `ctx-size` pins it.
///
/// Only then has fit already shrunk the context as far as `fit-ctx` allows by
/// the time a load runs out of memory, so "use a smaller context" would be
/// wrong advice. Any `ctx-size`, 0 included, stops fit from touching it
/// (`common/arg.cpp`: 0 asks for the full trained context). A model's own line
/// wins over `[*]`, the order the C++ loader applies them in. Only the spellings
/// Jan's preset generator writes are read.
pub fn fit_owns_context(ini: &str, section: &str) -> bool {
    let bodies = section_bodies(ini);
    let value = |key: &str| {
        [section, "*"].iter().find_map(|name| {
            bodies.get(*name)?.iter().find_map(|line| {
                let (k, v) = line.split_once('=')?;
                (k.trim() == key).then(|| v.trim().to_string())
            })
        })
    };
    // `common_arg_utils::is_falsey`; anything else leaves fit at its default.
    let fit_on = !matches!(
        value("fit").as_deref(),
        Some("off" | "disabled" | "false" | "0")
    );
    fit_on && value("ctx-size").is_none()
}

/// Load specs for every model in a preset.
///
/// The spec carries the section body so `Registry::reload` can diff it. Two
/// presets that differ only in a model Jan did not touch therefore leave that
/// model loaded, which is the whole point of reloading rather than restarting.
pub fn specs(ini_path: &str, ini: &str) -> HashMap<String, LoadSpec> {
    let mut bodies = section_bodies(ini);
    let shared = bodies.get("*").cloned().unwrap_or_default();
    sections(ini)
        .into_iter()
        .map(|section| {
            let mut body = shared.clone();
            body.extend(bodies.remove(&section).unwrap_or_default());
            body.sort();
            (
                section.clone(),
                LoadSpec::Preset {
                    ini_path: ini_path.to_string(),
                    section,
                    body,
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "\
[*]
parallel = 1

[Qwen3-0_6B-IQ4_XS]
model = /models/qwen.gguf
load-on-startup = false

[sentence-transformer-mini]
model = /models/st.gguf
embeddings = true
";

    #[test]
    fn sections_skips_the_shared_defaults_block() {
        assert_eq!(
            sections(INI),
            vec!["Qwen3-0_6B-IQ4_XS", "sentence-transformer-mini"]
        );
    }

    #[test]
    fn sections_tolerates_indentation_and_blank_files() {
        assert_eq!(sections("  [a]  \n key = 1"), vec!["a"]);
        assert!(sections("").is_empty());
        assert!(sections("key = 1\n# comment").is_empty());
    }

    #[test]
    fn a_shared_key_is_read_only_from_the_star_section() {
        let ini = "[*]\nslot-save-path = /a/b\n\n[m]\nslot-save-path = /c/d\n";
        assert_eq!(
            shared_value(ini, "slot-save-path"),
            Some("/a/b".to_string()),
            "a per-model override must not be mistaken for the engine-wide value"
        );
        assert_eq!(shared_value(ini, "absent"), None);
        assert_eq!(
            shared_value("[m]\nslot-save-path = /c/d\n", "slot-save-path"),
            None
        );
    }

    #[test]
    fn a_shared_value_keeps_paths_with_spaces_and_equals_signs() {
        let ini = "[*]\nslot-save-path = /home/a b/Jan Data/cache\n";
        assert_eq!(
            shared_value(ini, "slot-save-path"),
            Some("/home/a b/Jan Data/cache".to_string())
        );
        assert_eq!(
            shared_value("[*]\nchat-template = a=b\n", "chat-template"),
            Some("a=b".to_string())
        );
    }

    #[test]
    fn a_model_id_containing_brackets_is_not_mistaken_for_a_section() {
        assert!(sections("model = /a/[b].gguf").is_empty());
    }

    #[test]
    fn a_spec_carries_the_shared_defaults_so_a_change_there_reloads_every_model() {
        let base = specs("/p.ini", INI);
        let edited = specs("/p.ini", &INI.replace("parallel = 1", "parallel = 4"));
        for id in base.keys() {
            assert_ne!(base[id], edited[id], "{id} should differ");
        }
    }

    #[test]
    fn editing_one_model_leaves_the_others_specs_untouched() {
        let base = specs("/p.ini", INI);
        let edited = specs(
            "/p.ini",
            &INI.replace("load-on-startup = false", "load-on-startup = true"),
        );
        assert_ne!(base["Qwen3-0_6B-IQ4_XS"], edited["Qwen3-0_6B-IQ4_XS"]);
        assert_eq!(
            base["sentence-transformer-mini"],
            edited["sentence-transformer-mini"]
        );
    }

    #[test]
    fn fit_owns_the_context_only_when_on_and_no_ctx_size_pins_it() {
        let auto = "[*]\nparallel = 1\n\n[m]\nmodel = /m.gguf\n";
        assert!(fit_owns_context(auto, "m"), "fit is on by default");
        assert!(fit_owns_context("[*]\nfit = on\n[m]\n", "m"));

        // Jan's preset with fit off pins the shared context as well.
        let off = "[*]\nfit = off\nctx-size = 8192\n\n[m]\nmodel = /m.gguf\n";
        assert!(!fit_owns_context(off, "m"));
        assert!(!fit_owns_context("[*]\nfit = false\n[m]\n", "m"));

        // A user's own context, or 0 (the full trained one), is left alone by
        // fit, so a smaller context is still advice that helps.
        assert!(!fit_owns_context("[*]\n[m]\nctx-size = 32768\n", "m"));
        assert!(!fit_owns_context("[*]\n[m]\nctx-size = 0\n", "m"));
        assert!(fit_owns_context("[*]\n[m]\n[other]\nctx-size = 4096\n", "m"));

        // A model's own line overrides [*].
        assert!(fit_owns_context("[*]\nfit = off\n[m]\nfit = on\n", "m"));
    }

    // Comments and blank lines are not settings; a reload triggered by one
    // would cold-load the user's chat model for nothing.
    #[test]
    fn comments_and_blank_lines_do_not_count_as_a_change() {
        let commented = specs("/p.ini", &INI.replace("[*]", "# note\n\n[*]"));
        assert_eq!(specs("/p.ini", INI), commented);
    }

    // Key order within a section is an artifact of how the preset is written.
    #[test]
    fn key_order_within_a_section_does_not_count_as_a_change() {
        let reordered = specs(
            "/p.ini",
            "[a]\nmodel = /m.gguf\nembeddings = true\n",
        );
        let original = specs("/p.ini", "[a]\nembeddings = true\nmodel = /m.gguf\n");
        assert_eq!(original, reordered);
    }
}
