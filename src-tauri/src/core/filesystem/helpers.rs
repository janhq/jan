use super::grants::{ReadGrants, DENIED_PREFIX};
use crate::core::app::commands::get_jan_data_folder_path;
#[cfg(windows)]
use jan_utils::strip_verbatim_prefix;
use jan_utils::{normalize_file_path, normalize_path};
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

/// Builds a path string for `join_path`. It does no scope checks: the result is
/// only a string handed back to the caller, and every command that then touches
/// the file system resolves it again through one of the scoped resolvers below.
pub fn resolve_path<R: Runtime>(app_handle: tauri::AppHandle<R>, path: &str) -> PathBuf {
    let path = if path.starts_with("file:/") || path.starts_with("file:\\") {
        let normalized = normalize_file_path(path);
        let relative_normalized = normalized
            .trim_start_matches(std::path::MAIN_SEPARATOR)
            .trim_start_matches('/')
            .trim_start_matches('\\');
        get_jan_data_folder_path(app_handle).join(relative_normalized)
    } else {
        PathBuf::from(path)
    };

    if path.starts_with("http://") || path.starts_with("https://") {
        path
    } else {
        path.canonicalize().unwrap_or(path)
    }
}

fn is_file_uri(path: &str) -> bool {
    path.starts_with("file:/") || path.starts_with("file:\\")
}

fn resolve_path_input(path: &str, jan_data_folder: &Path) -> PathBuf {
    if is_file_uri(path) {
        let normalized = normalize_file_path(path);
        let relative_normalized = normalized
            .trim_start_matches(std::path::MAIN_SEPARATOR)
            .trim_start_matches('/')
            .trim_start_matches('\\');
        jan_data_folder.join(relative_normalized)
    } else {
        PathBuf::from(path)
    }
}

fn canonicalize_for_scope(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    let normalized = normalize_path(path);
    let mut current = normalized.clone();

    while !current.exists() {
        let Some(parent) = current.parent() else {
            return normalized;
        };
        current = parent.to_path_buf();
    }

    let Ok(canonical_parent) = current.canonicalize() else {
        return normalized;
    };

    let suffix = normalized
        .strip_prefix(&current)
        .map(|value| value.to_path_buf())
        .unwrap_or_default();

    normalize_path(&canonical_parent.join(suffix))
}

/// The form both sides of a containment check are compared in: `canonicalize`
/// returns `\\?\C:\x` and `\\?\UNC\server\share\x` on Windows, which become
/// `C:\x` and `\\server\share\x` (a data folder on a network drive stays
/// absolute instead of turning into a relative `UNC\server\share\x`).
fn normalize_scope_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(plain) = path.to_str().map(strip_verbatim_prefix) {
            return normalize_path(Path::new(&plain));
        }
    }

    normalize_path(&path)
}

/// The form [`super::grants`] compares in: symlinks resolved, verbatim
/// prefixes stripped, `.` and `..` folded.
pub fn canonical_scope_path(path: &Path) -> PathBuf {
    normalize_scope_path(canonicalize_for_scope(path))
}

pub fn resolve_path_within_jan_data_folder(
    jan_data_folder: &Path,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let canonical_data = normalize_scope_path(canonicalize_for_scope(jan_data_folder));
    let input_path = resolve_path_input(path, jan_data_folder);
    let resolved_path = if input_path.is_absolute() {
        normalize_path(&input_path)
    } else {
        normalize_path(&canonical_data.join(input_path))
    };
    let canonical_path = normalize_scope_path(canonicalize_for_scope(&resolved_path));

    if !canonical_path.starts_with(&canonical_data) {
        return Err(format!(
            "Path {} is outside of Jan data folder {}",
            canonical_path.display(),
            canonical_data.display()
        ));
    }

    Ok((canonical_data, canonical_path))
}

/// Scope for the read-only file commands (`exists_sync`, `file_stat`,
/// `read_file_sync`, `readdir_sync`).
///
/// `file:` URIs and relative paths are data-folder paths and must stay inside
/// it. An absolute path is readable when it
/// - is inside the data folder, or
/// - is covered by a grant: the user picked it, or a folder above it, in a
///   native dialog (attachments, project folders, models imported in place),
///   or
/// - is an ordinary file under `home`, the case of a typed `@path` reference
///   (see [`home_read_allowed`]).
///
/// Anything else fails with [`DENIED_PREFIX`]. The commands that create, move
/// or write files never take this path; they use
/// [`resolve_path_within_jan_data_folder`].
pub fn resolve_read_path(
    jan_data_folder: &Path,
    path: &str,
    grants: &ReadGrants,
) -> Result<PathBuf, String> {
    if is_file_uri(path) || !Path::new(path).is_absolute() {
        return resolve_path_within_jan_data_folder(jan_data_folder, path)
            .map(|(_, resolved)| resolved);
    }
    let path = PathBuf::from(path);
    let canonical = canonical_scope_path(&path);
    let allowed = canonical.starts_with(canonical_scope_path(jan_data_folder))
        || grants.allows(&canonical)
        || grants.allows_typed_reference(&canonical);
    if !allowed {
        return Err(format!(
            "{DENIED_PREFIX}: {} is outside the Jan data folder and the files and folders you picked",
            path.display()
        ));
    }
    Ok(path.canonicalize().unwrap_or(path))
}

pub fn resolve_app_read_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<PathBuf, String> {
    let jan_data_folder = get_jan_data_folder_path(app_handle.clone());
    // Without the managed grants nothing outside the data folder is readable.
    let state = app_handle.try_state::<ReadGrants>();
    let none = ReadGrants::default();
    let grants: &ReadGrants = state.as_deref().unwrap_or(&none);
    resolve_read_path(&jan_data_folder, path, grants)
}

pub fn resolve_app_path_within_jan_data_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let jan_data_folder = get_jan_data_folder_path(app_handle);
    resolve_path_within_jan_data_folder(&jan_data_folder, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn relative_path_resolves_inside_data_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().to_path_buf();
        fs::create_dir_all(data.join("threads")).unwrap();

        let (root, resolved) =
            resolve_path_within_jan_data_folder(&data, "threads").expect("resolves");
        assert!(resolved.starts_with(&root));
        assert!(resolved.ends_with("threads"));
    }

    #[test]
    fn file_uri_resolves_relative_to_data_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().to_path_buf();
        fs::create_dir_all(data.join("models")).unwrap();
        fs::write(data.join("models/info.json"), "{}").unwrap();

        let (root, resolved) =
            resolve_path_within_jan_data_folder(&data, "file://models/info.json")
                .expect("resolves");
        assert!(resolved.starts_with(&root));
        assert!(resolved.ends_with("info.json"));
    }

    #[test]
    fn rejects_parent_traversal_escaping_data_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "x").unwrap();

        let result = resolve_path_within_jan_data_folder(&data, "../outside/secret.txt");
        assert!(
            result.is_err(),
            "expected escape to be rejected, got {result:?}"
        );
    }

    #[test]
    fn absolute_path_inside_data_folder_is_allowed() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().to_path_buf();
        let inner = data.join("sub");
        fs::create_dir_all(&inner).unwrap();
        let absolute = inner.to_string_lossy().to_string();

        let (root, resolved) =
            resolve_path_within_jan_data_folder(&data, &absolute).expect("resolves");
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn absolute_path_outside_data_folder_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let elsewhere = tmp.path().join("elsewhere");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();

        let result = resolve_path_within_jan_data_folder(&data, &elsewhere.to_string_lossy());
        assert!(result.is_err());
    }

    #[test]
    fn file_uri_parent_traversal_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        fs::create_dir_all(&data).unwrap();

        for uri in ["file:/../..", "file://../outside", "file:/a/../../../outside"] {
            assert!(
                resolve_path_within_jan_data_folder(&data, uri).is_err(),
                "{uri} should be rejected"
            );
            assert!(
                resolve_read_path(&data, uri, &ReadGrants::default()).is_err(),
                "{uri} should be rejected for reads"
            );
        }
    }

    #[test]
    fn read_path_keeps_relative_paths_inside_data_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        fs::create_dir_all(data.join("models")).unwrap();

        let none = ReadGrants::default();
        let resolved = resolve_read_path(&data, "models", &none).expect("resolves");
        // Compare in the resolver's own form: on Windows `canonicalize` adds a
        // `\\?\` prefix that the resolver strips.
        assert!(resolved.starts_with(normalize_scope_path(canonicalize_for_scope(&data))));
        let resolved = resolve_read_path(&data, "file://models", &none).expect("resolves");
        assert!(resolved.ends_with("models"));
        assert!(resolve_read_path(&data, "../elsewhere", &none).is_err());
    }

    #[test]
    fn read_path_denies_an_absolute_path_nobody_granted() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let secret = tmp.path().join("secret.txt");
        fs::create_dir_all(&data).unwrap();
        fs::write(&secret, "s").unwrap();

        let err = resolve_read_path(&data, &secret.to_string_lossy(), &ReadGrants::default())
            .expect_err("denied");
        assert!(err.starts_with(DENIED_PREFIX), "{err}");
    }

    #[test]
    fn read_path_allows_absolute_paths_inside_the_data_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let file = data.join("models").join("m").join("model.yml");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "a: 1").unwrap();

        let resolved = resolve_read_path(&data, &file.to_string_lossy(), &ReadGrants::default())
            .expect("inside the data folder");
        assert_eq!(resolved, file.canonicalize().unwrap());
    }

    #[test]
    fn read_path_allows_a_granted_absolute_path() {
        // An imported model folder or an attachment lives outside the data folder.
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let model = tmp.path().join("imported-model");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&model).unwrap();
        let grants = ReadGrants::default();
        grants.record_pick(&model);

        let resolved =
            resolve_read_path(&data, &model.to_string_lossy(), &grants).expect("granted");
        assert_eq!(resolved, model.canonicalize().unwrap());
    }

    #[test]
    fn read_path_lets_a_typed_reference_reach_home_but_not_a_hidden_folder() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let home = tmp.path().join("home");
        let note = home.join("Documents").join("note.txt");
        let key = home.join(".ssh").join("id_rsa");
        for file in [&note, &key] {
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, "x").unwrap();
        }
        fs::create_dir_all(&data).unwrap();
        let grants = ReadGrants::with_home(Some(home));

        assert!(resolve_read_path(&data, &note.to_string_lossy(), &grants).is_ok());
        let err =
            resolve_read_path(&data, &key.to_string_lossy(), &grants).expect_err("hidden folder");
        assert!(err.starts_with(DENIED_PREFIX), "{err}");
    }

    #[test]
    fn resolves_nonexistent_child_paths_under_data_folder() {
        // Used when creating new files; canonicalize must not fail.
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().to_path_buf();

        let (root, resolved) = resolve_path_within_jan_data_folder(&data, "new/nested/file.txt")
            .expect("resolves nonexistent child");
        assert!(resolved.starts_with(&root));
        assert!(resolved.ends_with("file.txt"));
    }

    #[test]
    fn verbatim_data_folder_paths_compare_in_plain_form() {
        // Windows-style strings, checked on every host.
        for (data, child, plain_data) in [
            (
                r"\\?\UNC\server\share\Jan",
                r"\\?\UNC\server\share\Jan\threads\t.json",
                r"\\server\share\Jan",
            ),
            (
                r"\\?\C:\Users\u\Jan",
                r"\\?\C:\Users\u\Jan\threads\t.json",
                r"C:\Users\u\Jan",
            ),
        ] {
            let data = jan_utils::strip_verbatim_prefix(data);
            let child = jan_utils::strip_verbatim_prefix(child);
            assert_eq!(data, plain_data);
            assert!(child.starts_with(&format!("{data}\\")), "{child}");
        }
        // A plain path typed by the user lands in the same form.
        assert_eq!(
            jan_utils::strip_verbatim_prefix(r"\\server\share\Jan"),
            r"\\server\share\Jan"
        );
    }

    #[cfg(windows)]
    #[test]
    fn unc_data_folder_stays_absolute() {
        let plain = normalize_scope_path(PathBuf::from(r"\\?\UNC\server\share\Jan"));
        assert_eq!(plain, PathBuf::from(r"\\server\share\Jan"));
        assert!(plain.is_absolute());
        let child = normalize_scope_path(PathBuf::from(r"\\?\UNC\server\share\Jan\threads"));
        assert!(child.starts_with(&plain));
        assert_eq!(
            normalize_path(Path::new(r"\\?\UNC\server\share\Jan\x")),
            PathBuf::from(r"\\server\share\Jan\x")
        );
    }
}
