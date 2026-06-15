use std::path::PathBuf;

// Default MCP runtime settings
pub const DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const DEFAULT_MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
pub const DEFAULT_MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time

/// Sentinel inside `DEFAULT_MCP_CONFIG_TEMPLATE` that is replaced at runtime
/// with the per-user sandbox directory exposed to the filesystem MCP server.
const FILESYSTEM_DIR_PLACEHOLDER: &str = "__JAN_DEFAULT_FS_DIR__";

/// Sentinel inside `DEFAULT_MCP_CONFIG_TEMPLATE` replaced at runtime with the
/// version-pinned filesystem MCP package spec (single source of truth =
/// `FILESYSTEM_MCP_PINNED_VERSION`).
const FILESYSTEM_SPEC_PLACEHOLDER: &str = "__JAN_FS_MCP_SPEC__";

/// Literal placeholder path shipped in older versions of Atomic Chat. Existing
/// `mcp_config.json` files on disk may still contain this value; the runtime
/// migrates it to a real per-user sandbox path on next config read.
pub const LEGACY_FILESYSTEM_PLACEHOLDER: &str = "/path/to/other/allowed/dir";

/// npm package name of the filesystem MCP server. Used both in the default
/// config template and by the on-disk config migration that pins it.
pub const FILESYSTEM_MCP_PACKAGE: &str = "@modelcontextprotocol/server-filesystem";

/// Pinned version of the filesystem MCP server (ATO-164). Unversioned installs
/// resolved relative paths against `process.cwd()` (the app dir), so relative
/// writes failed with "outside allowed directories" — upstream bug
/// servers#2526, fixed in servers#2609. Pinning a *concrete* version also
/// busts the stale `bun`/`BUN_INSTALL` cache: `bun x <pkg>@<ver>` misses the
/// cached old version and fetches the fixed build. Bump this when a newer
/// fixed release is validated.
pub const FILESYSTEM_MCP_PINNED_VERSION: &str = "2026.1.14";

/// Fully-qualified, version-pinned spec written into args, e.g.
/// `@modelcontextprotocol/server-filesystem@2026.1.14`.
pub fn filesystem_mcp_pinned_spec() -> String {
    format!("{FILESYSTEM_MCP_PACKAGE}@{FILESYSTEM_MCP_PINNED_VERSION}")
}

const DEFAULT_MCP_CONFIG_TEMPLATE: &str = r#"{
  "mcpServers": {
    "Jan Browser MCP": {
      "command": "npx",
      "args": ["-y", "search-mcp-server@latest"],
      "env": {
        "BRIDGE_HOST": "127.0.0.1",
        "BRIDGE_PORT": "17389"
      },
      "active": false,
      "official": true
    },
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp",
      "command": "",
      "args": [],
      "env": {},
      "active": true
    },
    "browsermcp": {
      "command": "npx",
      "args": ["@browsermcp/mcp"],
      "env": {},
      "active": false
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {},
      "active": false
    },
    "serper": {
      "command": "npx",
      "args": ["-y", "serper-search-scrape-mcp-server"],
      "env": { "SERPER_API_KEY": "YOUR_SERPER_API_KEY_HERE" },
      "active": false
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "__JAN_FS_MCP_SPEC__",
        "__JAN_DEFAULT_FS_DIR__"
      ],
      "env": {},
      "cwd": "__JAN_DEFAULT_FS_DIR__",
      "active": false
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {},
      "active": false
    }
  },
  "mcpSettings": {
    "toolCallTimeoutSeconds": 30,
    "baseRestartDelayMs": 1000,
    "maxRestartDelayMs": 30000,
    "backoffMultiplier": 2.0
  }
}"#;

/// Default sandbox directory exposed to the `filesystem` MCP server.
/// Resolves to `~/Documents/Atomic_chat` (or the platform equivalent).
pub fn default_filesystem_root() -> PathBuf {
    let docs = dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .unwrap_or_else(|| PathBuf::from("."));
    docs.join("Atomic_chat")
}

/// Materialised default `mcp_config.json` content with a real, per-user
/// filesystem sandbox path substituted for the template placeholder.
/// Best-effort creates the sandbox directory on disk; failure to create it
/// is logged but non-fatal — the user can still edit the path manually.
pub fn default_mcp_config() -> String {
    let root = default_filesystem_root();
    if let Err(e) = std::fs::create_dir_all(&root) {
        log::warn!(
            "Failed to pre-create default MCP filesystem sandbox at {}: {e}",
            root.display()
        );
    }
    // `serde_json::to_string` produces a JSON-escaped, double-quoted literal,
    // which is safe to embed wherever a JSON string is expected.
    let path_literal = serde_json::to_string(&root.to_string_lossy().to_string())
        .unwrap_or_else(|_| "\".\"".to_string());
    DEFAULT_MCP_CONFIG_TEMPLATE
        .replace(&format!("\"{FILESYSTEM_DIR_PLACEHOLDER}\""), &path_literal)
        .replace(FILESYSTEM_SPEC_PLACEHOLDER, &filesystem_mcp_pinned_spec())
}
