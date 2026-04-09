use crate::core::app::commands::get_jan_data_folder_path;
use jan_utils::{normalize_file_path, normalize_path};
use std::path::{Path, PathBuf};
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

pub fn resolve_app_path_within_jan_data_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let jan_data_folder = get_jan_data_folder_path(app_handle);
    resolve_path_within_jan_data_folder(&jan_data_folder, path)
}
