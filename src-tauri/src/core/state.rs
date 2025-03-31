use std::{collections::HashMap, sync::Arc};

use rand::{distributions::Alphanumeric, Rng};
use rmcp::{service::RunningService, RoleClient};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>
}
pub fn generate_app_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}
