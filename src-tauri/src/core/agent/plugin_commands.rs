//! Plugin command discovery and invocation. A command is a Markdown prompt
//! template shipped by a plugin at `<plugin>/commands/<name>.md` (the Claude
//! Code convention, discovered recursively), with optional YAML frontmatter
//! (`description`, `argument-hint`). Commands are user-invoked from the slash
//! popup: the body is a prompt template with `$ARGUMENTS` and positional
//! `$1`..`$9` placeholders substituted from the typed arguments.

use std::path::{Path, PathBuf};

/// One command discovered in an installed plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandEntry {
    /// File stem (`feature-dev` for `commands/feature-dev.md`).
    pub name: String,
    /// The plugin directory this command ships in.
    pub plugin: String,
    /// Frontmatter `description`, or the first body line when absent.
    pub description: String,
    /// The markdown file to read for the prompt template.
    pub file: PathBuf,
    /// Placeholders the template accepts (`$1`..`$9`, `$ARGUMENTS`), surfaced
    /// in the slash popup so the human knows what arguments do.
    pub hints: Vec<String>,
}

/// A command file's parsed content: frontmatter description + body with the
/// frontmatter fence stripped (same tolerance as skills).
pub(crate) struct ParsedCommand {
    pub description: String,
    pub body: String,
}

/// Every command shipped by installed plugins, sorted by plugin then name.
/// Discovery is recursive (`commands/**/*.md`), skips `README.md` and
/// dotfiles, and ignores interrupted `.installing-*` staging directories.
pub(crate) fn discover(root: &Path) -> Vec<CommandEntry> {
    let dir = crate::core::agent::skills::plugins_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(plugin) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if plugin.starts_with(".installing-") {
            continue;
        }
        crate::core::agent::skills::walk_markdown_files(&path.join("commands"), &mut |path| {
            let raw = std::fs::read_to_string(path).unwrap_or_default();
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            let parsed = parse_command(&raw);
            out.push(CommandEntry {
                name: name.to_string(),
                plugin: plugin.to_string(),
                description: parsed.description,
                file: path.to_path_buf(),
                hints: template_hints(&parsed.body),
            });
        });
    }
    out.sort_by(|a, b| (&a.plugin, &a.name).cmp(&(&b.plugin, &b.name)));
    out
}
/// Commands offered to the human, honoring the `[skills].enabled` whitelist
/// (plugin name, qualified `<plugin>:<name>`, or plain name enable a command;
/// an empty whitelist enables everything).
pub(crate) fn catalog(root: &Path, enabled: &[String]) -> Vec<CommandEntry> {
    let commands = discover(root);
    if enabled.is_empty() {
        return commands;
    }
    commands
        .into_iter()
        .filter(|e| {
            let qualified = format!("{}:{}", e.plugin, e.name);
            enabled
                .iter()
                .any(|n| n == &qualified || n == &e.name || n == &e.plugin)
        })
        .collect()
}

/// Locate a command by the name a human typed: explicit `<plugin>:<name>`
/// first, then a plain name that is unique across installed plugins. Filters
/// through the `[skills].enabled` whitelist so disabled commands are not
/// resolvable.
pub(crate) fn resolve_from(root: &Path, name: &str, enabled: &[String]) -> Result<CommandEntry, String> {
    let commands = catalog(root, enabled);
    if let Some((plugin, plain)) = name.split_once(':') {
        if let Some(entry) = commands
            .iter()
            .find(|e| e.plugin == plugin && e.name == plain)
        {
            return Ok(entry.clone());
        }
    }
    let mut matches = commands.into_iter().filter(|e| e.name == name);
    match (matches.next(), matches.next()) {
        (Some(only), None) => Ok(only),
        _ => Err(format!("ERROR: command '{name}' not found")),
    }
}

/// Build the user message that runs a command: the invocation wrapper plus the
/// body with `$ARGUMENTS`/`$N` placeholders substituted. Returns
/// `(message, description)`, mirroring `skills::build_invocation_message`.
/// Honors the `[skills].enabled` whitelist: a disabled plugin/command is
/// rejected, matching the skill invocation path.
pub(crate) fn build_message(
    root: &Path,
    name: &str,
    args: &str,
) -> Result<(String, String), String> {
    let enabled = crate::core::agent::project::load_agent_config(root)
        .ok()
        .map(|c| c.skills.enabled)
        .unwrap_or_default();
    let entry = resolve_from(root, name, &enabled)?;
    let raw = std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))?;
    let parsed = parse_command(&raw);
    let body = substitute(&parsed.body, args.trim());
    let msg = format!(
        "{}\n\n{body}",
        crate::core::agent::skills::invocation_wrapper(name, "command")
    );
    Ok((msg, parsed.description))
}

/// Substitute `$ARGUMENTS` (the full argument string) and `$1`..`$9`
/// (whitespace-split positional words) in a command body. Missing positions
/// become empty. `$10` and `$ARGUMENTATION`-style tokens are left literal so a
/// body can still talk about dollars.
pub(crate) fn substitute(body: &str, args: &str) -> String {
    let positional: Vec<&str> = args.split_whitespace().collect();
    let mut out = String::with_capacity(body.len() + args.len());
    let mut rest = body;
    loop {
        let Some(rel) = rest.find('$') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..rel]);
        let tail = &rest[rel + 1..];
        if let Some(after) = tail.strip_prefix("ARGUMENTS") {
            if after.chars().next().map_or(true, |c| !c.is_alphanumeric()) {
                out.push_str(args);
                rest = after;
                continue;
            }
        }
        let mut chars = tail.chars();
        if let Some(d) = chars.next().and_then(|c| c.to_digit(10)) {
            let after_digit = chars.as_str();
            let next_ok = after_digit
                .chars()
                .next()
                .map_or(true, |c| !c.is_ascii_digit());
            if (1..=9).contains(&d) && next_ok {
                if let Some(word) = positional.get(d as usize - 1) {
                    out.push_str(word);
                }
                rest = after_digit;
                continue;
            }
        }
        out.push('$');
        rest = tail;
    }
    out
}

/// The placeholders a command template accepts (`$1`..`$9` then `$ARGUMENTS`),
/// surfaced in the slash popup. Mirrors opencode's `hints()`: numbered
/// placeholders first, `$ARGUMENTS` last. A `$N` is only advertised when it
/// would actually be substituted (so `$10`, `$11` are excluded, matching
/// `substitute`'s guard), and `$ARGUMENTS` is only advertised when it is not
/// part of a longer alphanumeric token such as `$ARGUMENTATION`.
pub(crate) fn template_hints(body: &str) -> Vec<String> {
    let mut out: Vec<String> = (1..=9)
        .filter(|n| {
            let needle = format!("${n}");
            body.match_indices(&needle)
                .any(|(i, _)| {
                    body[i + needle.len()..]
                        .chars()
                        .next()
                        .map_or(true, |c| !c.is_ascii_digit())
                })
        })
        .map(|n| format!("${n}"))
        .collect();
    let arguments_needed = body
        .match_indices("$ARGUMENTS")
        .any(|(i, _)| {
            body[i + "$ARGUMENTS".len()..]
                .chars()
                .next()
                .map_or(true, |c| !c.is_alphanumeric())
        });
    if arguments_needed {
        out.push("$ARGUMENTS".to_string());
    }
    out
}

/// Split leading `---\n...\n---` YAML frontmatter from a command body,
/// extracting the `description` (falling back to the first body line). Reuses
/// the skill parser's tolerance for missing/unterminated fences.
fn parse_command(raw: &str) -> ParsedCommand {
    let parsed = crate::core::agent::skills::parse(raw);
    let description = parsed
        .description
        .unwrap_or_else(|| crate::core::agent::skills::first_line(&parsed.body));
    ParsedCommand {
        description,
        body: parsed.body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::skills::plugins_dir;

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "jan_commands_{tag}_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn discover_finds_nested_commands_and_skips_readme_and_dotfiles() {
        let root = temp_root("disc");
        let cmd_dir = plugins_dir(&root).join("release").join("commands");
        std::fs::create_dir_all(cmd_dir.join("git")).unwrap();
        std::fs::write(
            cmd_dir.join("release.md"),
            "---\ndescription: Cut a release\n---\nRelease $1 for $ARGUMENTS.",
        )
        .unwrap();
        std::fs::write(cmd_dir.join("git").join("commit.md"), "commit body").unwrap();
        std::fs::write(cmd_dir.join("README.md"), "docs, not a command").unwrap();
        std::fs::write(cmd_dir.join(".hidden.md"), "skip me").unwrap();

        let discovered = discover(&root);
        let names: Vec<String> = discovered.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["commit", "release"]);
        assert!(discovered.iter().all(|e| e.plugin == "release"));
        // Placeholders in the template surface as hints, numbered first.
        let release = discovered.iter().find(|e| e.name == "release").unwrap();
        assert_eq!(release.hints, vec!["$1", "$ARGUMENTS"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn template_hints_find_numbered_and_arguments() {
        assert_eq!(
            template_hints("$1 then $2 and $ARGUMENTS"),
            vec!["$1", "$2", "$ARGUMENTS"]
        );
        assert_eq!(template_hints("$ARGUMENTS only"), vec!["$ARGUMENTS"]);
        assert_eq!(template_hints("plain body"), Vec::<String>::new());
    }

    #[test]
    fn resolve_supports_explicit_and_unique_plain_names() {
        let root = temp_root("resolve");
        let mk = |plugin: &str, name: &str| {
            let dir = plugins_dir(&root).join(plugin).join("commands");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{name}.md")), "body").unwrap();
        };
        mk("release", "prepare");
        mk("triage", "prepare");

        // Explicit form always works.
        assert!(resolve_from(&root, "release:prepare", &[]).is_ok());
        // Ambiguous plain name fails.
        assert!(resolve_from(&root, "prepare", &[]).is_err());
        // Unknown fails.
        assert!(resolve_from(&root, "nope", &[]).is_err());
        // Unique plain name resolves.
        mk("release", "ship");
        assert_eq!(resolve_from(&root, "ship", &[]).unwrap().name, "ship");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn substitute_replaces_arguments_and_positionals() {
        assert_eq!(
            substitute("request: $ARGUMENTS", "add auth"),
            "request: add auth"
        );
        assert_eq!(
            substitute("$1 then $2 then $1", "alpha beta"),
            "alpha then beta then alpha"
        );
        // Missing positional becomes empty.
        assert_eq!(substitute("[$1][$2]", "only"), "[only][]");
        // $10 is not $1 + "0"; $ARGUMENTATION is not $ARGUMENTS.
        assert_eq!(substitute("$10 $ARGUMENTATION", ""), "$10 $ARGUMENTATION");
        // No placeholders: body unchanged.
        assert_eq!(substitute("plain body", "ignored"), "plain body");
    }

    #[test]
    fn build_message_injects_body_and_substitutes_args() {
        let root = temp_root("msg");
        let cmd_dir = plugins_dir(&root).join("release").join("commands");
        std::fs::create_dir_all(&cmd_dir).unwrap();
        std::fs::write(
            cmd_dir.join("feature.md"),
            "---\ndescription: Build a feature\n---\nBuild: $ARGUMENTS",
        )
        .unwrap();

        let (msg, description) = build_message(&root, "feature", "add caching").unwrap();
        assert_eq!(description, "Build a feature");
        assert!(msg.contains("invoked the \"feature\" command"));
        assert!(msg.contains("Build: add caching"));
        // Unknown command errors.
        assert!(build_message(&root, "nope", "").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_filters_by_enabled_whitelist() {
        let root = temp_root("catalog");
        let mk = |plugin: &str, name: &str| {
            let dir = plugins_dir(&root).join(plugin).join("commands");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{name}.md")), "body").unwrap();
        };
        mk("release", "prepare");
        mk("triage", "prepare");

        // Empty whitelist: everything.
        assert_eq!(catalog(&root, &[]).len(), 2);
        // Plugin name enables all of its commands.
        assert_eq!(
            catalog(&root, &["release".to_string()])
                .iter()
                .map(|e| e.plugin.as_str())
                .collect::<Vec<_>>(),
            vec!["release"]
        );
        // Qualified name enables one command.
        let names: Vec<String> = catalog(&root, &["triage:prepare".to_string()])
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["prepare"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn template_hints_exclude_multi_digit_placeholders() {
        // $10/$11 contain "$1"/"$2" but substitute() leaves them literal, so
        // they must not be advertised as hints. Only the real $1..$9 show.
        assert_eq!(template_hints("cost $10 per $1"), vec!["$1"]);
        assert_eq!(template_hints("$10 $11"), Vec::<String>::new());
        assert_eq!(template_hints("$ARGUMENTATION is like $ARGUMENTS"), vec!["$ARGUMENTS"]);
    }

    #[test]
    fn build_message_enforces_disabled_whitelist() {
        let root = temp_root("msg-disabled");
        let cmd_dir = plugins_dir(&root).join("release").join("commands");
        std::fs::create_dir_all(&cmd_dir).unwrap();
        std::fs::write(cmd_dir.join("prepare.md"), "body").unwrap();
        std::fs::create_dir_all(root.join(".jan").join("agent")).unwrap();

        // With the command disabled (not in the whitelist), invocation errors,
        // matching the skill path.
        std::fs::write(
            root.join(".jan").join("agent").join("agent.toml"),
            "[skills]\nenabled = [\"some-other\"]\n",
        )
        .unwrap();
        assert!(build_message(&root, "prepare", "").is_err());
        // A command enabled by name resolves.
        std::fs::write(
            root.join(".jan").join("agent").join("agent.toml"),
            "[skills]\nenabled = [\"prepare\"]\n",
        )
        .unwrap();
        assert!(build_message(&root, "prepare", "").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }
}
