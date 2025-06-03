use anyhow::Result;
use rmcp::model::{Tool, Content};
use serde_json::Value;

/// Trait for built-in MCP modules
pub trait MCPBuiltIn {
    /// Get all tools provided by this module
    fn get_tools(&self) -> Result<Vec<Tool>>;
    
    /// Execute a tool call
    async fn call_tool(&self, name: &str, arguments: Value) -> Result<Vec<Content>>;
    
    /// Get the module name/prefix
    fn module_name(&self) -> &'static str;
    
    /// Initialize the module
    async fn initialize(&mut self) -> Result<()>;
}