//! The files each hidden `screenshot` window may load.
//!
//! The webview renderer opens its target as a `file:` URL, and that page is
//! model-written, so it can point itself or a frame at any other file and the
//! PNG would carry it back. The renderer records each window's target here
//! before the window exists, and the app's navigation guard asks [`allows`]
//! before a screenshot window loads a `file:` URL: only the target and files
//! under its directory (its own css, images, scripts) pass, or the target alone
//! when it lies outside the agent's trusted roots ([`PageScope`]).
//!
//! Tauri-free: the renderer registers, the guard in the app crate reads.
//!
//! [`allows`]: ScreenshotPages::allows

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// The pages of the windows the renderer has open, read by the navigation
/// guard.
pub static SCREENSHOT_PAGES: ScreenshotPages = ScreenshotPages::new();

/// What a screenshot window may load besides its target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageScope {
    /// The files under the target's directory too: a page inside the agent's
    /// workspace, scratch or attached folders.
    Directory,
    /// The target alone: a page the user approved outside those roots, whose
    /// directory (`~/Desktop`, say) holds files nobody approved.
    FileOnly,
}

struct Page {
    target: PathBuf,
    /// `None` for [`PageScope::FileOnly`].
    dir: Option<PathBuf>,
}

pub struct ScreenshotPages {
    pages: Mutex<BTreeMap<String, Page>>,
}

impl ScreenshotPages {
    pub const fn new() -> Self {
        Self {
            pages: Mutex::new(BTreeMap::new()),
        }
    }

    /// Lets the window labelled `label` load `target`, and with
    /// [`PageScope::Directory`] the files under its directory, both as they
    /// resolve now.
    pub fn register(&self, label: &str, target: &Path, scope: PageScope) -> Result<(), String> {
        let target = std::fs::canonicalize(target)
            .map_err(|e| format!("cannot resolve {}: {e}", target.display()))?;
        let dir = match scope {
            PageScope::Directory => Some(
                target
                    .parent()
                    .ok_or_else(|| format!("{} has no parent directory", target.display()))?
                    .to_path_buf(),
            ),
            PageScope::FileOnly => None,
        };
        self.lock().insert(label.to_string(), Page { target, dir });
        Ok(())
    }

    pub fn unregister(&self, label: &str) {
        self.lock().remove(label);
    }

    /// Whether the window labelled `label` may load the file at `path`.
    /// Canonicalized first, so `..` segments and symlinks are judged by where
    /// they land; a path that does not resolve to a regular file is refused.
    pub fn allows(&self, label: &str, path: &Path) -> bool {
        let Ok(canon) = std::fs::canonicalize(path) else {
            return false;
        };
        if !canon.is_file() {
            return false;
        }
        self.lock()
            .get(label)
            .is_some_and(|page| {
                canon == page.target || page.dir.as_ref().is_some_and(|dir| canon.starts_with(dir))
            })
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Page>> {
        self.pages.lock().unwrap_or_else(|p| p.into_inner())
    }
}

impl Default for ScreenshotPages {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-shot-pages-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("chart.html"), "<svg></svg>").unwrap();
        std::fs::write(dir.join("assets/style.css"), "body{}").unwrap();
        dir
    }

    #[test]
    fn the_target_and_files_beside_it_are_allowed_for_its_window_only() {
        let dir = temp_dir("in");
        let pages = ScreenshotPages::new();
        assert!(!pages.allows("jan-shot-1", &dir.join("chart.html")));
        pages
            .register("jan-shot-1", &dir.join("chart.html"), PageScope::Directory)
            .unwrap();
        assert!(pages.allows("jan-shot-1", &dir.join("chart.html")));
        assert!(pages.allows("jan-shot-1", &dir.join("assets/style.css")));
        assert!(!pages.allows("jan-shot-2", &dir.join("chart.html")));
        // A directory is not a page.
        assert!(!pages.allows("jan-shot-1", &dir.join("assets")));
        pages.unregister("jan-shot-1");
        assert!(!pages.allows("jan-shot-1", &dir.join("chart.html")));
    }

    #[test]
    fn a_file_only_page_allows_the_target_and_nothing_beside_it() {
        let dir = temp_dir("file-only");
        std::fs::write(dir.join("notes.txt"), "private").unwrap();
        let pages = ScreenshotPages::new();
        pages
            .register("jan-shot-1", &dir.join("chart.html"), PageScope::FileOnly)
            .unwrap();
        assert!(pages.allows("jan-shot-1", &dir.join("chart.html")));
        assert!(!pages.allows("jan-shot-1", &dir.join("notes.txt")));
        assert!(!pages.allows("jan-shot-1", &dir.join("assets/style.css")));
    }

    #[test]
    fn files_outside_the_target_directory_are_refused_however_spelled() {
        let dir = temp_dir("out");
        let other = temp_dir("other");
        let pages = ScreenshotPages::new();
        pages
            .register("jan-shot-1", &dir.join("chart.html"), PageScope::Directory)
            .unwrap();
        assert!(!pages.allows("jan-shot-1", &other.join("chart.html")));
        let escape = dir
            .join("..")
            .join(other.file_name().unwrap())
            .join("chart.html");
        assert!(!pages.allows("jan-shot-1", &escape));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_target_directory_is_refused() {
        let dir = temp_dir("link");
        let other = temp_dir("secret");
        std::os::unix::fs::symlink(other.join("chart.html"), dir.join("leak.html")).unwrap();
        let pages = ScreenshotPages::new();
        pages
            .register("jan-shot-1", &dir.join("chart.html"), PageScope::Directory)
            .unwrap();
        assert!(!pages.allows("jan-shot-1", &dir.join("leak.html")));
    }

    #[test]
    fn registering_a_missing_target_errors() {
        let pages = ScreenshotPages::new();
        assert!(pages
            .register(
                "jan-shot-1",
                Path::new("/definitely/not/here.html"),
                PageScope::Directory
            )
            .is_err());
    }
}
