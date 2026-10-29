//! OpenAI `tools` array entries for the built-in tools, one per BUILTIN_TOOLS
//! entry. These are advertised to the model when a project is active; execution
//! is dispatched by `handlers::execute_builtin` and gated by `gate`.
//!
//! Two views, one schema each: [`builtin_tool_schemas`] is what a model is
//! offered, and [`search_tool_schemas`] holds `ls`/`find`/`grep`, which the
//! model is not offered because `bash` covers them. A caller that has no `bash`
//! -- an external MCP client served the read-only set -- takes both.

use serde_json::{json, Value};

/// The `memory` tool's description: what it is for and the reconcile rule that
/// keeps the index small (janhq/jan-internal#497).
const MEMORY_DESCRIPTION: &str = "Your long-term memory: durable facts (decisions, conventions, preferences, gotchas) kept across sessions. It is yours to curate; no op asks the user. Before writing, `search` or `view` for an existing note on the topic and update it (`edit`, or `write` over it) rather than adding another. When a new fact supersedes a note, `delete` the old one. When work a note tracks is finished, archive it by adding front matter `status: done` (it stays readable and searchable but leaves the index). Group related notes in a folder with `move` (`name` to `tui/scroll`); never write an index or overview note, the index is built for you. Keep notes short; never store secrets or session-only state.";

/// The `bash` tool's description before any shell-specific note.
const BASH_DESCRIPTION: &str = "Run a shell command in the project root. Returns combined stdout and stderr, followed by a final `[exit N]` line (or `[terminated by signal]`). Judge success by that exit code, not by whether there is text on stderr: many commands (e.g. `git push`) write normal status to stderr on success, so `[exit 0]` means it worked. The output is COMPLETE and verbatim: trust it and do not re-run a command to double-check. It is truncated only when it exceeds 2000 lines or 64KB, and only then is an explicit `[output truncated ...]` notice appended with a temp-file path holding the full output; when truncated the LAST lines are kept (so the final result and errors stay visible). Absent that notice, you have the full output.";

/// The `bash` description for a shell of `kind`. The model writes POSIX by
/// default, so a PowerShell or cmd host says so up front rather than letting the
/// first command fail. Fixed per process (the shell is resolved once), so the
/// tool array stays byte-identical across turns.
pub fn bash_description(kind: super::proc::ShellKind) -> String {
    match kind.syntax_note() {
        Some(note) => format!("{note} {BASH_DESCRIPTION}"),
        None => BASH_DESCRIPTION.to_string(),
    }
}

/// Appended to the shell description when the run offers escalation.
const ESCALATE_NOTE: &str = " Commands run inside an OS sandbox. If a command that matters to the task fails because of the sandbox (a read-only file system or permission error outside the project, such as a package manager writing its cache, or a blocked download), rerun the same command with `escalate: true` and a one-line `justification`: the user is asked to approve running it outside the sandbox. Never escalate pre-emptively, and never to work around a denial the user gave.";

/// Add the escalation arguments to the `shell` schema in `schemas`, for a run
/// whose shell is sandboxed and whose user can be asked to lift it. Applied
/// once per run by the caller, so the array stays byte-identical across turns;
/// a run without escalation keeps the plain schema.
pub fn offer_escalation(schemas: &mut [Value]) {
    for schema in schemas.iter_mut() {
        let function = &mut schema["function"];
        if function["name"] != super::SHELL_TOOL {
            continue;
        }
        if let Some(description) = function["description"].as_str() {
            function["description"] = Value::String(format!("{description}{ESCALATE_NOTE}"));
        }
        let properties = &mut function["parameters"]["properties"];
        properties[super::gate::ESCALATE_ARG] = json!({
            "type": "boolean",
            "description": "Ask the user to run this command outside the sandbox. Only after it failed inside it."
        });
        properties[super::gate::JUSTIFICATION_ARG] = json!({
            "type": "string",
            "description": "Required with escalate: why the command needs to leave the sandbox, shown to the user."
        });
    }
}

/// OpenAI function schemas for the built-in tools, one per `BUILTIN_TOOLS`
/// entry. `screenshot` is desktop-only (`feature = "tauri"`), so the headless
/// CLI advertises one fewer.
pub fn builtin_tool_schemas() -> Vec<Value> {
    [
        json!({
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read the contents of a UTF-8 text file. Output is truncated to 2000 lines or 64KB (whichever is hit first). Use offset/limit for large files. Image files (png/jpeg/gif/webp, detected by signature or extension) are returned as a vision image instead of text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path relative to the project root (or absolute)." },
                        "offset": { "type": "integer", "description": "Line number to start reading from (1-indexed)." },
                        "limit": { "type": "integer", "description": "Maximum number of lines to read." }
                    },
                    "required": ["path"]
                }
            }
        }),
        // ls / find / grep are deliberately NOT advertised here: `bash` covers
        // listing and searching (`ls`, `find`, `grep`/`rg`), so dedicated tools
        // for them only enlarge the schema a weak model has to handle. They stay
        // in BUILTIN_TOOLS -- recognized, gated, and executable if named -- and
        // their schemas live in `search_tool_schemas` for callers that have no
        // `bash` to cover them.
        #[cfg(feature = "tauri")]
        json!({
            "type": "function",
            "function": {
                "name": "screenshot",
                "description": "Render a local HTML or SVG file and return a PNG screenshot of it, so you can see what you built and iterate on the visual result. Use after writing an HTML/SVG artifact to check its appearance; the returned image is what a viewer would see. Relative assets (images, css, js) resolve against the file's own directory. Non-HTML/SVG files are rejected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Project-relative or absolute path to the .html/.htm/.svg file to render." },
                        "width": { "type": "integer", "description": "Viewport width in pixels (default 1280)." },
                        "height": { "type": "integer", "description": "Viewport height in pixels (default 960)." }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "write",
                "description": "Create or overwrite a file relative to the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path relative to the project root." },
                        "content": { "type": "string", "description": "Full file contents to write." }
                    },
                    "required": ["path", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "edit",
                "description": "Edit a file using one or more exact text replacements applied in order. Each old_string must match exactly once in the current file state.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path relative to the project root." },
                        "edits": {
                            "type": "array",
                            "description": "Targeted replacements applied in order.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "old_string": { "type": "string", "description": "Exact text to replace (must be unique at apply time)." },
                                    "new_string": { "type": "string", "description": "Replacement text." }
                                },
                                "required": ["old_string", "new_string"]
                            }
                        }
                    },
                    "required": ["path", "edits"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": super::SHELL_TOOL,
                "description": bash_description(super::proc::shell().kind),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to run." },
                        "timeout": { "type": "integer", "description": "Seconds to wait before backgrounding the command if it hasn't finished (default 30)." }
                    },
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": super::MEMORY_TOOL,
                "description": MEMORY_DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "op": { "type": "string", "enum": ["view", "search", "write", "edit", "delete", "move"], "description": "view: the index (no name), a folder's notes (`folder/`), or a note's content. search: keyword search over titles and bodies, archived notes included. write: create or overwrite. edit: replace one exact, unique `old` with `new`. delete: remove a note. move: rename `name` to `to` (e.g. into a folder), keeping its content." },
                        "name": { "type": "string", "description": "Note name without .md: `note` or `folder/note` (this project), `user:note` (every project), `project:<slug>` or `project:<slug>/note` (another project, read-only). Required for write, edit, delete and move. `index` and `MEMORY` are reserved: the index is built for you." },
                        "to": { "type": "string", "description": "move: the new name, `note` or `folder/note`; must not exist yet." },
                        "query": { "type": "string", "description": "search: words that must all appear in the note." },
                        "title": { "type": "string", "description": "write: one-line title, stored as the note's first line and shown in the index." },
                        "content": { "type": "string", "description": "write: the note's Markdown body. Front matter `status: done` archives it." },
                        "old": { "type": "string", "description": "edit: exact text to replace; must occur exactly once." },
                        "new": { "type": "string", "description": "edit: replacement text." }
                    },
                    "required": ["op"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "skill_list",
                "description": "List the available skills (reusable procedures) with a one-line description of each. No arguments.",
                "parameters": { "type": "object", "properties": {}, "required": [] }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "skill_read",
                "description": "Load a skill's full instructions by name. The system prompt lists each skill's name and purpose; call this to read the complete procedure before applying a skill.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Skill name (without the .md extension)." }
                    },
                    "required": ["name"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "skill_write",
                "description": "Create or update a skill (a reusable procedure). Keep it concise.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Skill name (without the .md extension); becomes the skill title." },
                        "content": { "type": "string", "description": "Full Markdown content of the skill." },
                        "scope": { "type": "string", "enum": ["project", "user"], "description": "Where to store it: `project` (default) for this project only, `user` for every project." }
                    },
                    "required": ["name", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web and return a ranked list of results (title, URL, snippet, and optional publish date). Use this to find current information, documentation, or sources you can then read with web_fetch. Cite the URLs you rely on. This is a native, provider-neutral capability; do not look for a provider-branded search tool.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "The search query." },
                        "count": { "type": "integer", "description": "Maximum number of results to return (default 5, max 20)." }
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "Fetch a web page by URL and return its readable text content along with the source URL and title. Output is bounded to avoid flooding the context. Use after web_search to read a specific result. This is a native, provider-neutral capability.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "The http(s) URL to fetch." }
                    },
                    "required": ["url"]
                }
            }
        }),
    ]
    .to_vec()
}

/// Schemas for the three search tools a model is not offered (`bash` covers
/// them for the agent). Kept out of [`builtin_tool_schemas`] so the model's tool
/// array stays small, and defined here rather than at a call site so there is
/// still exactly one copy of each schema in the tree.
///
/// Taken by a surface that serves the read-only toolset without `bash`, where
/// otherwise nothing could list or search at all.
pub fn search_tool_schemas() -> Vec<Value> {
    [
        json!({
            "type": "function",
            "function": {
                "name": "ls",
                "description": "List the entries of a directory, one per line, with directories marked by a trailing slash.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path relative to the project root (or absolute). Defaults to the root." },
                        "limit": { "type": "integer", "description": "Maximum number of entries to return (default 500)." }
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "find",
                "description": "Find files whose path matches a glob pattern, honoring .gitignore. Use this to locate files by name; use grep to search their contents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Glob pattern to match against each path, e.g. **/*.rs." },
                        "path": { "type": "string", "description": "Directory to search under, relative to the project root. Defaults to the root." },
                        "limit": { "type": "integer", "description": "Maximum number of paths to return (default 1000)." }
                    },
                    "required": ["pattern"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search file contents for a regular expression, honoring .gitignore, and return matching lines with their file and line number.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Regular expression to search for, or a literal string when literal is true." },
                        "path": { "type": "string", "description": "Directory or file to search, relative to the project root. Defaults to the root." },
                        "glob": { "type": "string", "description": "Only search paths matching this glob, e.g. *.rs." },
                        "ignore_case": { "type": "boolean", "description": "Match case-insensitively (default false)." },
                        "literal": { "type": "boolean", "description": "Treat pattern as a literal string rather than a regex (default false)." },
                        "context": { "type": "integer", "description": "Lines of context to include around each match (default 0)." },
                        "limit": { "type": "integer", "description": "Maximum number of matches to return (default 100)." }
                    },
                    "required": ["pattern"]
                }
            }
        }),
    ]
    .to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::BUILTIN_TOOLS;

    /// The plain array never mentions escalation; offering it touches only the
    /// shell entry, adding both arguments and the when-to-use note.
    #[test]
    fn escalation_is_offered_only_on_request_and_only_on_the_shell() {
        let plain = builtin_tool_schemas();
        assert!(!serde_json::to_string(&plain).unwrap().contains("escalate"));
        let mut offered = plain.clone();
        offer_escalation(&mut offered);
        for (before, after) in plain.iter().zip(&offered) {
            if before["function"]["name"] == crate::tools::SHELL_TOOL {
                let props = &after["function"]["parameters"]["properties"];
                assert_eq!(props["escalate"]["type"], "boolean");
                assert_eq!(props["justification"]["type"], "string");
                assert!(after["function"]["description"].as_str().unwrap().contains("escalate: true"));
                // Still optional: an ordinary call needs only `command`.
                assert_eq!(after["function"]["parameters"]["required"], json!(["command"]));
            } else {
                assert_eq!(before, after);
            }
        }
    }

    /// ls/find/grep stay in BUILTIN_TOOLS (recognized + executable) but are not
    /// advertised -- bash covers listing and searching -- so the offered set is
    /// BUILTIN_TOOLS minus that trio. Every other builtin must be advertised, in
    /// the same order, so a new one can't be silently added and never offered.
    #[test]
    fn advertised_schemas_are_the_builtins_minus_the_unadvertised() {
        let schemas = builtin_tool_schemas();
        for schema in &schemas {
            assert_eq!(schema["type"], "function");
        }
        let names: Vec<&str> = schemas
            .iter()
            .map(|s| s["function"]["name"].as_str().unwrap())
            .collect();
        let expected: Vec<&str> = BUILTIN_TOOLS
            .iter()
            .map(|t| t.name)
            .filter(|n| !matches!(*n, "ls" | "find" | "grep"))
            .collect();
        assert_eq!(names, expected);
    }

    /// The two views together must cover BUILTIN_TOOLS exactly: no builtin
    /// without a schema, and no schema for something that is not a builtin.
    #[test]
    fn the_two_schema_views_together_cover_every_builtin() {
        let mut names: Vec<String> = builtin_tool_schemas()
            .iter()
            .chain(search_tool_schemas().iter())
            .map(|s| s["function"]["name"].as_str().unwrap().to_string())
            .collect();
        names.sort();
        let mut expected: Vec<String> =
            BUILTIN_TOOLS.iter().map(|t| t.name.to_string()).collect();
        expected.sort();
        assert_eq!(names, expected);
    }

    /// `skill_write` gains an optional `scope` (janhq/jan-internal#394):
    /// additive, so `required` is unchanged and a caller that omits it keeps
    /// writing to the project. The schema must also serialize to the same
    /// bytes every time, since the tool array sits in the cached prefix.
    #[test]
    fn skill_write_scope_is_optional_and_the_schema_is_deterministic() {
        let schemas = builtin_tool_schemas();
        let write = schemas
            .iter()
            .find(|s| s["function"]["name"] == "skill_write")
            .expect("skill_write advertised");
        let params = &write["function"]["parameters"];
        assert_eq!(params["required"], json!(["name", "content"]));
        assert_eq!(params["properties"]["scope"]["type"], "string");
        assert_eq!(params["properties"]["scope"]["enum"], json!(["project", "user"]));
        let once = serde_json::to_string(&builtin_tool_schemas()).unwrap();
        let twice = serde_json::to_string(&builtin_tool_schemas()).unwrap();
        assert_eq!(once, twice);
    }

    /// One `memory` tool carries every op and the reconcile rule; the three
    /// old tools are gone with no aliases.
    #[test]
    fn memory_is_one_tool_with_six_ops_and_the_reconcile_rule() {
        let schemas = builtin_tool_schemas();
        let names: Vec<&str> = schemas.iter().filter_map(|s| s["function"]["name"].as_str()).collect();
        assert!(names.contains(&"memory"));
        assert!(!names.iter().any(|n| n.starts_with("memory_")), "{names:?}");
        let memory = schemas.iter().find(|s| s["function"]["name"] == "memory").unwrap();
        let params = &memory["function"]["parameters"];
        assert_eq!(params["required"], json!(["op"]));
        assert_eq!(
            params["properties"]["op"]["enum"],
            json!(["view", "search", "write", "edit", "delete", "move"])
        );
        assert!(params["properties"]["to"].is_object(), "move takes `to`");
        let description = memory["function"]["description"].as_str().unwrap();
        for rule in ["`search` or `view`", "`delete` the old one", "`status: done`", "no op asks the user"] {
            assert!(description.contains(rule), "{rule}: {description}");
        }
    }

    /// A PowerShell or cmd host says so before the generic text, so the model
    /// reads it before writing a command; a POSIX host is unchanged.
    #[test]
    fn the_bash_description_leads_with_the_shells_syntax() {
        use crate::tools::proc::ShellKind;
        assert_eq!(bash_description(ShellKind::Posix), BASH_DESCRIPTION);
        for kind in [ShellKind::PowerShell, ShellKind::Cmd] {
            let d = bash_description(kind);
            assert!(d.starts_with(kind.syntax_note().unwrap()), "{d}");
            assert!(d.ends_with(BASH_DESCRIPTION));
        }
    }

    /// The search schemas name the arguments the handlers actually read; a
    /// rename on either side would otherwise silently produce a tool whose
    /// required argument never arrives.
    #[test]
    fn search_schemas_declare_the_handler_arguments() {
        let schemas = search_tool_schemas();
        for schema in &schemas {
            assert_eq!(schema["type"], "function");
            assert_eq!(schema["function"]["parameters"]["type"], "object");
        }
        let by_name = |n: &str| -> Value {
            schemas
                .iter()
                .find(|s| s["function"]["name"] == n)
                .expect("schema present")
                .clone()
        };
        // `path` is optional everywhere (it defaults to the root); `pattern` is
        // required exactly where the handler errors without it.
        assert!(by_name("ls")["function"]["parameters"]["properties"]["path"].is_object());
        assert_eq!(by_name("ls")["function"]["parameters"]["required"], json!([]));
        for tool in ["find", "grep"] {
            let s = by_name(tool);
            assert_eq!(
                s["function"]["parameters"]["required"],
                json!(["pattern"]),
                "{tool}"
            );
        }
        for key in ["glob", "ignore_case", "literal", "context", "limit"] {
            assert!(
                by_name("grep")["function"]["parameters"]["properties"][key].is_object(),
                "grep is missing {key}"
            );
        }
    }
}
