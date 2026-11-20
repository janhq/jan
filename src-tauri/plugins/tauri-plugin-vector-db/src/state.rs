use std::path::PathBuf;

pub struct VectorDBState {
    pub base_dir: PathBuf,
}

impl VectorDBState {
    /// `base_dir` comes from the host app (see `db::base_dir_in`). There is no
    /// `Default`, so the plugin cannot silently fall back to the real profile.
    pub fn new(base_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&base_dir).ok();
        Self { base_dir }
    }
}
