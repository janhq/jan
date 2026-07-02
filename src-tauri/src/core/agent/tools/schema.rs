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
                "description": "Run a shell command in the project root. Returns combined stdout and stderr. Output is truncated to 2000 lines or 64KB; full output is saved to a temp file when truncated. Optional timeout in seconds.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to run." },
                        "timeout": { "type": "integer", "description": "Timeout in seconds (optional, no default timeout)." }
                    },
                    "required": ["command"]
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
        assert_eq!(schemas.len(), 7);
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
