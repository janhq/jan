use rmcp::{
    handler::client::ClientHandler,
    model::{ClientInfo, ProgressNotificationParam},
    service::NotificationContext,
    RoleClient,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

/// Event name the frontend listens on for MCP tool progress.
pub const MCP_TOOL_PROGRESS_EVENT: &str = "mcp-tool-progress";

/// A `notifications/progress` update from an MCP server.
///
/// The notification carries no tool name -- only the progress token, which rmcp
/// generates per request and does not surface on the plain `call_tool` path --
/// so the server is the only identity here. Tools execute one at a time, so the
/// frontend attaches this to the call it already knows is running.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProgress {
    pub server: String,
    pub progress: f64,
    pub total: Option<f64>,
    pub message: Option<String>,
    /// Percentage, only when the server reported a usable total.
    pub percent: Option<f64>,
}

pub fn tool_progress(server: &str, params: &ProgressNotificationParam) -> ToolProgress {
    // A zero or negative total would make the ratio meaningless or divide by
    // zero, and a server may report progress past a stale total.
    let percent = params
        .total
        .filter(|total| *total > 0.0)
        .map(|total| (params.progress / total * 100.0).clamp(0.0, 100.0));

    ToolProgress {
        server: server.to_string(),
        progress: params.progress,
        total: params.total,
        message: params.message.clone(),
        percent,
    }
}

/// Emits one progress update. Erases the Tauri runtime parameter, which would
/// otherwise spread from the handler through the shared MCP server map and
/// every function that touches it.
type ProgressSink = Arc<dyn Fn(ToolProgress) + Send + Sync>;

/// Client handler for one MCP server connection.
///
/// Exists so progress notifications are observed at all: rmcp routes them to
/// the handler, and the previous `()` handler dropped them.
#[derive(Clone)]
pub struct JanClientHandler {
    info: ClientInfo,
    server: String,
    emit: ProgressSink,
}

impl JanClientHandler {
    pub fn new<R: Runtime>(info: ClientInfo, server: String, app: AppHandle<R>) -> Self {
        let name = server.clone();
        let emit: ProgressSink = Arc::new(move |payload| {
            if let Err(e) = app.emit(MCP_TOOL_PROGRESS_EVENT, &payload) {
                log::warn!("Failed to emit MCP progress for {name}: {e}");
            }
        });
        Self { info, server, emit }
    }
}

impl ClientHandler for JanClientHandler {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }

    async fn on_progress(
        &self,
        params: ProgressNotificationParam,
        _context: NotificationContext<RoleClient>,
    ) {
        (self.emit)(tool_progress(&self.server, &params));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{NumberOrString, ProgressToken};

    fn params(progress: f64, total: Option<f64>) -> ProgressNotificationParam {
        ProgressNotificationParam {
            progress_token: ProgressToken(NumberOrString::Number(1)),
            progress,
            total,
            message: None,
        }
    }

    #[test]
    fn computes_a_percentage_when_the_total_is_known() {
        assert_eq!(tool_progress("s", &params(25.0, Some(50.0))).percent, Some(50.0));
    }

    #[test]
    fn reports_no_percentage_without_a_total() {
        let p = tool_progress("s", &params(7.0, None));
        assert_eq!(p.percent, None);
        assert_eq!(p.progress, 7.0);
    }

    // Servers are only required to increase `progress`; the total can be stale
    // or absent, and a zero total would divide by zero.
    #[test]
    fn survives_an_unusable_total() {
        assert_eq!(tool_progress("s", &params(5.0, Some(0.0))).percent, None);
        assert_eq!(tool_progress("s", &params(5.0, Some(-1.0))).percent, None);
        assert_eq!(
            tool_progress("s", &params(80.0, Some(50.0))).percent,
            Some(100.0)
        );
    }

    #[test]
    fn carries_the_server_and_message_through() {
        let mut p = params(1.0, Some(4.0));
        p.message = Some("indexing".to_string());
        let payload = tool_progress("github", &p);
        assert_eq!(payload.server, "github");
        assert_eq!(payload.message.as_deref(), Some("indexing"));
    }
}
