use std::path::PathBuf;

pub struct VectorDBState {
    pub base_dir: PathBuf,
}

impl VectorDBState {
    pub fn new() -> Self {
        // Default vector db path: /Jan/data/db
        let mut base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        base.push("Jan");
        base.push("data");
        base.push("db");
        std::fs::create_dir_all(&base).ok();
        Self { base_dir: base }
    }
}
