//! User attachments imported into a Cowork session workspace.
//!
//! A document the user attaches to a question lives wherever the file picker
//! found it, outside every root the filesystem tools may read. Copying it into
//! the workspace is what puts it in the agent's reach; an extracted-text
//! sibling is what makes a binary format (PDF, DOCX) readable by `read`, which
//! refuses anything that is not UTF-8.

use std::path::{Path, PathBuf};

use super::spill::{open_excl, sanitize_stem, validated_subdir};

/// Workspace subdirectory holding imported attachments.
pub const ATTACHMENTS_DIR: &str = "attachments";

/// Suffix of the extracted-text sibling written beside a binary document.
pub const TEXT_SUFFIX: &str = ".txt";

/// Refuse anything larger: the composer already caps attachments, so this is
/// the backstop against a caller bypassing it, not the user-facing limit.
pub const MAX_ATTACHMENT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedAttachment {
    /// The copy inside the workspace.
    pub path: PathBuf,
    /// The extracted-text sibling, when text was supplied.
    pub text_path: Option<PathBuf>,
}

/// Copy `source` into `<workspace>/attachments/`, writing `text` beside it as
/// `<name>.txt` when given. Names are sanitized to one safe component and
/// suffixed (`-2`, `-3`, ...) rather than overwritten, so two questions that
/// attach different files of the same name keep both.
pub fn import_attachment(
    workspace: &Path,
    source: &Path,
    text: Option<&str>,
) -> Result<ImportedAttachment, String> {
    let meta = std::fs::metadata(source)
        .map_err(|e| format!("cannot read attachment {}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err(format!("attachment {} is not a file", source.display()));
    }
    if meta.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "attachment {} is {} bytes, over the {} byte limit",
            source.display(),
            meta.len(),
            MAX_ATTACHMENT_BYTES
        ));
    }
    let dir = validated_subdir(workspace, ATTACHMENTS_DIR)
        .ok_or_else(|| "could not create the attachments directory".to_string())?;
    let base = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = split_name(&base);
    let stem = sanitize_stem(&stem);

    for n in 1..100 {
        let name = match (n, ext.as_str()) {
            (1, "") => stem.clone(),
            (1, ext) => format!("{stem}.{ext}"),
            (n, "") => format!("{stem}-{n}"),
            (n, ext) => format!("{stem}-{n}.{ext}"),
        };
        let path = dir.join(&name);
        let text_path = text.map(|_| dir.join(format!("{name}{TEXT_SUFFIX}")));
        // Both names are claimed together, so a stray `x.pdf.txt` cannot pair
        // with the wrong `x.pdf`.
        let mut file = match open_excl(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot create {}: {e}", path.display())),
        };
        let text_file = match &text_path {
            Some(tp) => match open_excl(tp) {
                Ok(f) => Some(f),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("cannot create {}: {e}", tp.display()));
                }
            },
            None => None,
        };
        let mut src = std::fs::File::open(source)
            .map_err(|e| format!("cannot open attachment {}: {e}", source.display()))?;
        std::io::copy(&mut src, &mut file)
            .map_err(|e| format!("cannot copy attachment into {}: {e}", path.display()))?;
        if let (Some(mut tf), Some(t)) = (text_file, text) {
            use std::io::Write;
            tf.write_all(t.as_bytes())
                .map_err(|e| format!("cannot write extracted text: {e}"))?;
        }
        return Ok(ImportedAttachment { path, text_path });
    }
    Err(format!("too many attachments named {base}"))
}

/// `report.final.pdf` -> (`report.final`, `pdf`); a dotfile or a bare name has
/// no extension.
fn split_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i + 1..].to_lowercase()),
        _ => (name.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-attach-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_the_file_and_writes_the_text_beside_it() {
        let ws = tmp("copy");
        let src_dir = tmp("copy-src");
        let src = src_dir.join("Spec v2.pdf");
        std::fs::write(&src, b"%PDF-1.4 binary").unwrap();

        let got = import_attachment(&ws, &src, Some("extracted words")).unwrap();
        assert_eq!(got.path, ws.join("attachments/Spec-v2.pdf"));
        assert_eq!(got.text_path, Some(ws.join("attachments/Spec-v2.pdf.txt")));
        assert_eq!(std::fs::read(&got.path).unwrap(), b"%PDF-1.4 binary");
        assert_eq!(
            std::fs::read_to_string(got.text_path.unwrap()).unwrap(),
            "extracted words"
        );
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&src_dir);
    }

    #[test]
    fn a_second_file_of_the_same_name_is_suffixed_not_overwritten() {
        let ws = tmp("dup");
        let src_dir = tmp("dup-src");
        let src = src_dir.join("notes.md");
        std::fs::write(&src, "one").unwrap();
        let first = import_attachment(&ws, &src, None).unwrap();
        std::fs::write(&src, "two").unwrap();
        let second = import_attachment(&ws, &src, Some("two")).unwrap();
        assert_eq!(first.path, ws.join("attachments/notes.md"));
        assert_eq!(first.text_path, None);
        assert_eq!(second.path, ws.join("attachments/notes-2.md"));
        assert_eq!(
            second.text_path,
            Some(ws.join("attachments/notes-2.md.txt"))
        );
        assert_eq!(std::fs::read_to_string(&first.path).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(&second.path).unwrap(), "two");
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&src_dir);
    }

    #[test]
    fn refuses_a_directory_and_a_missing_file() {
        let ws = tmp("refuse");
        assert!(import_attachment(&ws, &ws, None).is_err());
        assert!(import_attachment(&ws, &ws.join("nope.pdf"), None).is_err());
        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn splits_names_like_a_shell_would() {
        assert_eq!(split_name("a.b.PDF"), ("a.b".into(), "pdf".into()));
        assert_eq!(split_name("README"), ("README".into(), String::new()));
        assert_eq!(split_name(".env"), (".env".into(), String::new()));
    }
}
