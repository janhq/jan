//! The `preview://` scheme: serves artifact files to the Cowork preview pane
//! from a real origin, so a page keeps `localStorage` and resolves relative
//! assets, neither of which an opaque-origin `srcdoc` frame can do.
//!
//! The origin is shared with nothing else in the app, and what it can serve is
//! bounded by [`PreviewRoots`]: a request resolves only to a file under a root
//! the pane registered, so model markup cannot link its way to the rest of the
//! disk even though the asset protocol's own scope is `**/*`. Each root carries
//! the network flag the pane chose, emitted as a CSP header on every response;
//! the page cannot change it because it never sees the registration.
//!
//! Tauri-free: the scheme wiring lives in `lib.rs`, the commands in `commands.rs`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct PreviewRoots {
    roots: Mutex<HashMap<PathBuf, bool>>,
}

/// A file the scheme may serve, with the network flag of the root it sits in.
pub struct Served {
    pub path: PathBuf,
    pub allow_network: bool,
}

impl PreviewRoots {
    pub fn register(&self, root: &Path, allow_network: bool) -> Result<(), String> {
        let canon = std::fs::canonicalize(root).map_err(|e| format!("ERROR: {e}"))?;
        if !canon.is_dir() {
            return Err(format!("ERROR: not a directory: {}", root.display()));
        }
        self.lock().insert(canon, allow_network);
        Ok(())
    }

    pub fn unregister(&self, root: &Path) {
        let Ok(canon) = std::fs::canonicalize(root) else {
            return;
        };
        self.lock().remove(&canon);
    }

    /// The file a request path names, or `None` when it is not a regular file
    /// under a registered root. Canonicalized first, so `..` segments and
    /// symlinks are judged by where they land, not how they are spelled.
    pub fn resolve(&self, request_path: &str) -> Option<Served> {
        let decoded = percent_encoding::percent_decode_str(request_path)
            .decode_utf8()
            .ok()?;
        let canon = std::fs::canonicalize(fs_path(&decoded)).ok()?;
        if !canon.is_file() {
            return None;
        }
        let roots = self.lock();
        let (_, allow_network) = roots.iter().find(|(root, _)| canon.starts_with(root))?;
        Some(Served {
            path: canon,
            allow_network: *allow_network,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, bool>> {
        self.roots.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// The URL path is the absolute filesystem path with real slashes (so relative
/// references resolve against the file's directory). On Windows that puts a
/// `/` in front of the drive letter, which is not part of the path.
fn fs_path(decoded: &str) -> PathBuf {
    if cfg!(windows) {
        let bytes = decoded.as_bytes();
        if bytes.len() >= 3
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && bytes[2] == b':'
        {
            return PathBuf::from(&decoded[1..]);
        }
    }
    PathBuf::from(decoded)
}

/// The document policy for a served page. `'self'` is what lets the page load
/// its own css/js/images from beside itself; `https:` joins only when the pane's
/// network toggle is on. Mirrors `htmlSandbox.ts` for the srcdoc frame.
pub fn csp(allow_network: bool) -> String {
    let net = if allow_network { " https:" } else { "" };
    [
        "default-src 'none'".to_string(),
        format!("script-src 'self' 'unsafe-inline' blob:{net}"),
        format!("style-src 'self' 'unsafe-inline'{net}"),
        format!("img-src 'self' data: blob:{net}"),
        format!("font-src 'self' data:{net}"),
        format!("media-src 'self' data: blob:{net}"),
        "worker-src 'self' blob:".to_string(),
        format!("connect-src 'self'{net}"),
    ]
    .join("; ")
}

pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" | "md" | "csv" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-preview-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<canvas></canvas>").unwrap();
        std::fs::write(dir.join("assets/a b.png"), b"png").unwrap();
        dir
    }

    fn url_path(p: &Path) -> String {
        let s = p.to_string_lossy().replace('\\', "/");
        let s = s.replace(' ', "%20");
        if s.starts_with('/') {
            s
        } else {
            format!("/{s}")
        }
    }

    #[test]
    fn serves_files_under_a_registered_root_only() {
        let root = temp_root("in");
        let roots = PreviewRoots::default();
        assert!(roots.resolve(&url_path(&root.join("index.html"))).is_none());
        roots.register(&root, false).unwrap();
        let served = roots.resolve(&url_path(&root.join("index.html"))).unwrap();
        assert!(served.path.ends_with("index.html"));
        assert!(!served.allow_network);
        // Percent-decoded, so a space in a name is found.
        assert!(roots
            .resolve(&url_path(&root.join("assets/a b.png")))
            .is_some());
        // A directory is not a file to serve.
        assert!(roots.resolve(&url_path(&root.join("assets"))).is_none());
    }

    #[test]
    fn a_path_outside_every_root_is_refused_however_spelled() {
        let root = temp_root("out");
        let other = temp_root("other");
        let roots = PreviewRoots::default();
        roots.register(&root, true).unwrap();
        assert!(roots
            .resolve(&url_path(&other.join("index.html")))
            .is_none());
        let traversal = format!(
            "{}/../{}/index.html",
            url_path(&root),
            other.file_name().unwrap().to_string_lossy()
        );
        assert!(roots.resolve(&traversal).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_refused() {
        let root = temp_root("link");
        let other = temp_root("target");
        std::os::unix::fs::symlink(other.join("index.html"), root.join("leak.html")).unwrap();
        let roots = PreviewRoots::default();
        roots.register(&root, false).unwrap();
        assert!(roots.resolve(&url_path(&root.join("leak.html"))).is_none());
    }

    #[test]
    fn network_flag_follows_the_root_and_unregister_closes_it() {
        let root = temp_root("net");
        let roots = PreviewRoots::default();
        roots.register(&root, true).unwrap();
        assert!(
            roots
                .resolve(&url_path(&root.join("index.html")))
                .unwrap()
                .allow_network
        );
        roots.register(&root, false).unwrap();
        assert!(
            !roots
                .resolve(&url_path(&root.join("index.html")))
                .unwrap()
                .allow_network
        );
        roots.unregister(&root);
        assert!(roots.resolve(&url_path(&root.join("index.html"))).is_none());
    }

    #[test]
    fn registering_a_missing_root_errors() {
        let roots = PreviewRoots::default();
        assert!(roots
            .register(Path::new("/definitely/not/here"), false)
            .is_err());
    }

    #[test]
    fn csp_opens_https_only_with_network() {
        let closed = csp(false);
        assert!(closed.contains("script-src 'self' 'unsafe-inline' blob:;"));
        assert!(!closed.contains("https:"));
        assert!(closed.contains("connect-src 'self'"));
        let open = csp(true);
        assert!(open.contains("connect-src 'self' https:"));
        assert!(open.contains("script-src 'self' 'unsafe-inline' blob: https:"));
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(
            mime_for(Path::new("a/index.HTML")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            mime_for(Path::new("game.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_for(Path::new("x.bin")), "application/octet-stream");
    }
}
