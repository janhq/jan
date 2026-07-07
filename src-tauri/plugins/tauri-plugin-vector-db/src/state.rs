use std::path::PathBuf;

pub struct VectorDBState {
    pub base_dir: PathBuf,
}

impl Default for VectorDBState {
    fn default() -> Self {
        Self::new()
    }
}

impl VectorDBState {
    pub fn new() -> Self {
        let base = crate::db::default_base_dir();
        std::fs::create_dir_all(&base).ok();
        Self { base_dir: base }
    }
}
