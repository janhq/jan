//! OpenAI `tools` array entries for the built-in tools, one per BUILTIN_TOOLS
//! entry. These are advertised to the model when a project is active; execution
//! is dispatched by `handlers::execute_builtin` and gated by `gate`.

use serde_json::{json, Value};

/// OpenAI function schemas for the 7 built-in tools.
pub fn builtin_tool_schemas() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read the contents of a UTF-8 text file. Output is truncated to 2000 lines or 64KB (whichever is hit first). Use offset/limit for large files.",
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
        json!({
            "type": "function",
            "function": {
                "name": "ls",
                "description": "List directory contents sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Truncated to the entry limit or 64KB.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory to list (default '.')." },
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
                "description": "Search for files by glob pattern, e.g. '*.ts', '**/*.json', or 'src/**/*.rs'. Returns paths relative to the search directory. Respects .gitignore.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Glob pattern to match files." },
                        "path": { "type": "string", "description": "Directory to search in (default '.')." },
                        "limit": { "type": "integer", "description": "Maximum number of results (default 1000)." }
                    },
                    "required": ["pattern"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Truncated to the match limit or 64KB.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Search pattern (regex or literal string)." },
                        "path": { "type": "string", "description": "Directory or file to search (default '.')." },
                        "glob": { "type": "string", "description": "Filter files by glob pattern, e.g. '*.ts' or '**/*.rs'." },
                        "ignore_case": { "type": "boolean", "description": "Case-insensitive search (default false)." },
                        "literal": { "type": "boolean", "description": "Treat pattern as a literal string instead of regex (default false)." },
                        "context": { "type": "integer", "description": "Number of lines to show before and after each match (default 0)." },
                        "limit": { "type": "integer", "description": "Maximum number of matches to return (default 100)." }
                    },
                    "required": ["pattern"]
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
                "name": "bash",
                "description": "Run a shell command in the project root. Returns combined stdout and stderr, followed by a final `[exit N]` line (or `[terminated by signal]`). Judge success by that exit code, not by whether there is text on stderr: many commands (e.g. `git push`) write normal status to stderr on success, so `[exit 0]` means it worked. The output is COMPLETE and verbatim: trust it and do not re-run a command to double-check. It is truncated only when it exceeds 10000 lines or 256KB, and only then is an explicit `[output truncated ...]` notice appended with a temp-file path holding the full output; when truncated the LAST lines are kept (so the final result and errors stay visible). Absent that notice, you have the full output. If the command doesn't finish within `timeout` seconds (default 30), it keeps running in the background and this call returns a job_id instead of erroring or killing it; call bash again with only job_id set to wait for and collect its output once it finishes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to run. Omit when polling with job_id." },
                        "timeout": { "type": "integer", "description": "Seconds to wait before backgrounding the command if it hasn't finished (default 30)." },
                        "job_id": { "type": "string", "description": "Poll a previously backgrounded command by the job_id it returned, instead of running a new command." }
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "memory_list",
                "description": "List the names of your project memory notes (durable facts stored across sessions). No arguments.",
                "parameters": { "type": "object", "properties": {}, "required": [] }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "memory_read",
                "description": "Read one of your project memory notes by name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Note name (without the .md extension)." }
                    },
                    "required": ["name"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "memory_write",
                "description": "Create or overwrite a project memory note. Use for durable, non-obvious facts (decisions, conventions, preferences). Keep it short.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Note name (without the .md extension); one topic per note." },
                        "content": { "type": "string", "description": "Full Markdown content of the note." }
                    },
                    "required": ["name", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "skill_list",
                "description": "List the project skills (reusable procedures) with a one-line description of each. No arguments.",
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
                "description": "Create or update a project skill (a reusable procedure for this project). Keep it concise.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Skill name (without the .md extension); becomes the skill title." },
                        "content": { "type": "string", "description": "Full Markdown content of the skill." }
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
        json!({
            "type": "function",
            "function": {
                "name": "screenshot",
                "description": "Render a local HTML or SVG file with headless Chrome and return a PNG screenshot of it, so you can see what you built and iterate on the visual result. Use after writing an HTML/SVG artifact to check its appearance; the returned image is what a viewer would see. Relative assets (images, css, js) resolve against the file's own directory. Non-HTML/SVG files are rejected.",
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
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::tools::BUILTIN_TOOLS;

    #[test]
    fn schemas_match_builtin_tools() {
        let schemas = builtin_tool_schemas();
        assert_eq!(schemas.len(), 16);
        for schema in &schemas {
            assert_eq!(schema["type"], "function");
        }
        let names: Vec<&str> = schemas
            .iter()
            .map(|s| s["function"]["name"].as_str().unwrap())
            .collect();
        let expected: Vec<&str> = BUILTIN_TOOLS.iter().map(|t| t.name).collect();
        assert_eq!(names, expected);
    }
}
