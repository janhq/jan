//! Tool manifest — loaded once at startup from the bundled `tools/manifest.json`.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sandbox {
    Wasm,
    Microvm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub id:          String,
    pub description: String,
    pub sandbox:     Sandbox,
    pub risk:        RiskLevel,
    pub parameters:  serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version:   String,
    pub build_key: String,
    pub tools:     Vec<ToolDef>,
}

impl Manifest {
    /// Load from `<tools_dir>/manifest.json`.
    /// Falls back to the built-in default when missing or unparseable.
    pub fn load(tools_dir: &Path) -> Self {
        let path = tools_dir.join("manifest.json");
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(m) = serde_json::from_str(&raw) {
                return m;
            }
            log::info!("[agent] manifest.json parse error — using default");
        } else {
            log::info!("[agent] no manifest.json at {} — using default", path.display());
        }
        Self::default()
    }

    pub fn find(&self, id: &str) -> Option<&ToolDef> {
        self.tools.iter().find(|t| t.id == id)
    }
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            version:   "0.1.0".into(),
            build_key: "dev".into(),
            tools:     vec![
                ToolDef {
                    id:          "web.search".into(),
                    description: "Search the web and return a sanitized summary.".into(),
                    sandbox:     Sandbox::Wasm,
                    risk:        RiskLevel::Medium,
                    parameters:  serde_json::json!({
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "Search query" }
                        },
                        "required": ["query"]
                    }),
                },
                ToolDef {
                    id:          "code.exec".into(),
                    description: "Execute code in an isolated microVM. Returns stdout/stderr only.".into(),
                    sandbox:     Sandbox::Microvm,
                    risk:        RiskLevel::Critical,
                    parameters:  serde_json::json!({
                        "type": "object",
                        "properties": {
                            "language": { "type": "string", "description": "Language: python, js, bash" },
                            "code":     { "type": "string", "description": "Code to execute" }
                        },
                        "required": ["language", "code"]
                    }),
                },
            ],
        }
    }
}
