use crate::core::app::commands::get_jan_data_folder_path;
use jan_utils::normalize_file_path;
use std::path::PathBuf;
use tauri::Runtime;

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
fn resolve_path_input(path: &str, jan_data_folder: &Path) -> PathBuf {
    if path.starts_with("file:/") || path.starts_with("file:\\") {
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

fn normalize_scope_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return normalize_path(Path::new(stripped));
        }
    }

    normalize_path(&path)
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
        assert!(result.is_err(), "expected escape to be rejected, got {result:?}");
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

        let result =
            resolve_path_within_jan_data_folder(&data, &elsewhere.to_string_lossy());
        assert!(result.is_err());
    }

    #[test]
    fn resolves_nonexistent_child_paths_under_data_folder() {
        // Used when creating new files; canonicalize must not fail.
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().to_path_buf();

        let (root, resolved) =
            resolve_path_within_jan_data_folder(&data, "new/nested/file.txt")
                .expect("resolves nonexistent child");
        assert!(resolved.starts_with(&root));
        assert!(resolved.ends_with("file.txt"));
    }
}

pub fn resolve_app_path_within_jan_data_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let jan_data_folder = get_jan_data_folder_path(app_handle);
    resolve_path_within_jan_data_folder(&jan_data_folder, path)
}
