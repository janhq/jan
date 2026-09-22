//! The stdio transport for [`JanToolServer`]: the child-process shape every
//! other agent already knows how to spawn.
//!
//! stdout carries the JSON-RPC framing and nothing else. Anything this process
//! would otherwise print (logs, progress, a banner) must go to stderr, or the
//! peer's parser sees a corrupt stream; the caller is responsible for having
//! routed its logger there before calling [`serve`].

use rmcp::transport::io::stdio;
use rmcp::ServiceExt;

use super::{JanToolServer, ServeOptions};

/// Serve the built-in toolset over stdin/stdout until the peer disconnects.
pub async fn serve(opts: ServeOptions) -> Result<(), String> {
    let service = JanToolServer::new(opts)
        .serve(stdio())
        .await
        .map_err(|e| format!("failed to start the MCP stdio server: {e}"))?;
    service
        .waiting()
        .await
        .map_err(|e| format!("MCP stdio server stopped: {e}"))?;
    Ok(())
}
