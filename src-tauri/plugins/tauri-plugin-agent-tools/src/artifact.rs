//! What Cowork's "Open" may hand to the OS default app.
//!
//! The file was written by the agent, and the sandboxed shell can make any
//! name it likes: `report.pdf` may be a link to a program, or a program
//! itself. Opening runs whatever the OS associates with the file it lands on,
//! so the decision rests on the file, not on the name the frontend saw.
//!
//! Tauri-free: the command that opens the checked file lives in `commands.rs`.

use std::path::{Path, PathBuf};

use crate::workspace;

/// Extensions "Open" may hand to the default app: documents, media and plain
/// text. Mirrors `OPENS_IN_DEFAULT_APP` in the web app's `coworkPreview.ts`,
/// which skips the round trip for anything else.
const OPENS_IN_DEFAULT_APP: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "txt", "md", "markdown", "csv",
    "tsv", "json", "html", "htm", "rtf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "mp3", "wav",
    "ogg", "flac", "m4a", "aac", "opus", "mp4", "webm", "mov", "mkv", "avi", "m4v",
];

/// The roots "Open" may reach, from the ones the frontend names: anything
/// inside the Cowork sessions' sandboxes, or a folder that passes the checks a
/// writable attach does. Any other root is dropped, so a file under it is
/// refused.
pub fn open_roots(data_folder: &Path, requested: &[String]) -> Vec<PathBuf> {
    let sessions = workspace::sessions_dir(data_folder);
    let sessions = sessions.canonicalize().unwrap_or(sessions);
    let home = workspace::user_home();
    requested
        .iter()
        .filter_map(|root| {
            let canon = Path::new(root).canonicalize().ok()?;
            if workspace::is_within(&canon, &sessions) {
                return Some(canon);
            }
            let canon = workspace::validate_read_root(&canon, &sessions, Some(data_folder)).ok()?;
            workspace::validate_write_root(&canon, home.as_deref(), data_folder).ok()?;
            Some(canon)
        })
        .collect()
}

/// The file at `path`, canonicalized, if "Open" may hand it to its default
/// app: not itself a link, a regular file inside one of `roots`, of an
/// allowed type where it really lives, and (on Unix) not executable.
pub fn checked_artifact(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let link = std::fs::symlink_metadata(path)
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    if link.file_type().is_symlink() {
        return Err(format!("{} is a link and is not opened", path.display()));
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let meta =
        std::fs::metadata(&canon).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if !roots.iter().any(|root| workspace::is_within(&canon, root)) {
        return Err(format!(
            "{} is outside the session's folders",
            path.display()
        ));
    }
    let allowed = canon
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| OPENS_IN_DEFAULT_APP.contains(&e.to_ascii_lowercase().as_str()));
    if !allowed {
        return Err(format!(
            "{} is not a type that opens in another app",
            path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 != 0 {
            return Err(format!(
                "{} is executable and is not opened",
                path.display()
            ));
        }
    }
    Ok(canon)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-artifact-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn an_allowed_document_inside_a_root_opens() {
        let root = temp_root("doc");
        std::fs::write(root.join("Report.PDF"), b"%PDF-1.7").unwrap();
        let got = checked_artifact(&root.join("Report.PDF"), std::slice::from_ref(&root)).unwrap();
        assert_eq!(got, root.join("Report.PDF"));
    }

    #[test]
    fn a_file_outside_every_root_is_refused() {
        let root = temp_root("root");
        let other = temp_root("other");
        std::fs::write(other.join("report.pdf"), b"%PDF").unwrap();
        let err =
            checked_artifact(&other.join("report.pdf"), std::slice::from_ref(&root)).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        // Climbing out by `..` is judged by where it lands.
        let climbed = root
            .join("..")
            .join(other.file_name().unwrap())
            .join("report.pdf");
        assert!(checked_artifact(&climbed, &[root]).is_err());
    }

    #[test]
    fn a_type_the_os_would_run_is_refused() {
        let root = temp_root("type");
        for name in ["run.command", "setup.exe", "x.sh", "noext"] {
            std::fs::write(root.join(name), b"x").unwrap();
            assert!(
                checked_artifact(&root.join(name), std::slice::from_ref(&root)).is_err(),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_refused_even_to_an_allowed_type() {
        let root = temp_root("link");
        let prog = root.join("prog");
        std::fs::write(&prog, b"#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink(&prog, root.join("report.pdf")).unwrap();
        std::fs::write(root.join("real.pdf"), b"%PDF").unwrap();
        std::os::unix::fs::symlink(root.join("real.pdf"), root.join("alias.pdf")).unwrap();
        for name in ["report.pdf", "alias.pdf"] {
            let err = checked_artifact(&root.join(name), std::slice::from_ref(&root)).unwrap_err();
            assert!(err.contains("link"), "{name}: {err}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_executable_file_is_refused_whatever_its_name() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("exec");
        let file = root.join("report.pdf");
        std::fs::write(&file, b"\x7fELF").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = checked_artifact(&file, &[root]).unwrap_err();
        assert!(err.contains("executable"), "{err}");
    }

    #[test]
    fn only_session_sandboxes_and_attachable_folders_are_roots() {
        let data = temp_root("data");
        let session = workspace::sessions_dir(&data).join("s1");
        std::fs::create_dir_all(&session).unwrap();
        let folder = temp_root("folder");
        let roots = open_roots(
            &data,
            &[
                session.to_string_lossy().into_owned(),
                folder.to_string_lossy().into_owned(),
                // The data folder itself holds settings and keys; the
                // filesystem root has no outside; a missing folder is nothing.
                data.to_string_lossy().into_owned(),
                "/".to_string(),
                data.join("missing").to_string_lossy().into_owned(),
            ],
        );
        assert_eq!(roots, vec![session.canonicalize().unwrap(), folder]);
    }
}
