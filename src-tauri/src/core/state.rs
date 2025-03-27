use rand::{distributions::Alphanumeric, Rng};

pub struct AppState {
    pub app_token: Option<String>,
}

pub fn generate_app_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}