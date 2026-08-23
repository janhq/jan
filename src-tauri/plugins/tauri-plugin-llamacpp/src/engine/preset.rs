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
