// WARNING: These APIs will be deprecated soon due to removing FS API access from frontend.
// It's added to ensure the legacy implementation from frontend still functions before removal.
use crate::core::cmd::get_jan_data_folder_path;
use std::fs;
use std::path::PathBuf;
use tauri::Runtime;

#[tauri::command]
pub fn rm<R: Runtime>(app_handle: tauri::AppHandle<R>, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("rm error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn mkdir<R: Runtime>(app_handle: tauri::AppHandle<R>, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("mkdir error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn join_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<String, String> {
    if args.is_empty() {
        return Err("join_path error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    let joined_path = path.join(args[1..].join("/"));
    Ok(joined_path.to_string_lossy().to_string())
}
#[tauri::command]
pub fn exists_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<bool, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("exist_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    Ok(path.exists())
}

#[tauri::command]
pub fn read_file_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<String, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("read_file_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn readdir_sync<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<Vec<String>, String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("read_dir_sync error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    log::error!("Reading directory: {:?}", path);
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let paths: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect();
    Ok(paths)
}

fn normalize_file_path(path: &str) -> String {
    path.replace("file:/", "").replace("file:\\", "")
}

fn resolve_path<R: Runtime>(app_handle: tauri::AppHandle<R>, path: &str) -> PathBuf {
    let path = if path.starts_with("file:/") || path.starts_with("file:\\") {
        let normalized = normalize_file_path(path);
        let relative_normalized = normalized.strip_prefix("/").unwrap_or(&normalized);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use serde_json::to_string;
    use tauri::test::mock_app;

    #[test]
    fn test_rm() {
        let app = mock_app();
        let path = "test_rm_dir";
        fs::create_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path)).unwrap();
        let args = vec![format!("file://{}", path).to_string()];
        let result = rm(app.handle().clone(), args);
        assert!(result.is_ok());
        assert!(!get_jan_data_folder_path(app.handle().clone())
            .join(path)
            .exists());
    }

    #[test]
    fn test_mkdir() {
        let app = mock_app();
        let path = "test_mkdir_dir";
        let args = vec![format!("file://{}", path).to_string()];
        let result = mkdir(app.handle().clone(), args);
        assert!(result.is_ok());
        assert!(get_jan_data_folder_path(app.handle().clone())
            .join(path)
            .exists());
        fs::remove_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path)).unwrap();
    }

    #[test]
    fn test_join_path() {
        let app = mock_app();
        let path = "file://test_dir";
        let args = vec![path.to_string(), "test_file".to_string()];
        let result = join_path(app.handle().clone(), args).unwrap();
        assert_eq!(
            result,
            get_jan_data_folder_path(app.handle().clone())
                .join("test_dir/test_file")
                .to_string_lossy()
                .to_string()
        );
    }

    #[test]
    fn test_exists_sync() {
        let app = mock_app();
        let path = "file://test_exists_sync_file";
        let dir_path = get_jan_data_folder_path(app.handle().clone());
        fs::create_dir_all(&dir_path).unwrap();
        let file_path = dir_path.join("test_exists_sync_file");
        File::create(&file_path).unwrap();
        let args: Vec<String> = vec![path.to_string()];
        let result = exists_sync(app.handle().clone(), args).unwrap();
        assert!(result);
        fs::remove_file(file_path).unwrap();
    }

    #[test]
    fn test_read_file_sync() {
        let app = mock_app();
        let path = "file://test_read_file_sync_file";
        let dir_path = get_jan_data_folder_path(app.handle().clone());
        fs::create_dir_all(&dir_path).unwrap();
        let file_path = dir_path.join("test_read_file_sync_file");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"test content").unwrap();
        let args = vec![path.to_string()];
        let result = read_file_sync(app.handle().clone(), args).unwrap();
        assert_eq!(result, "test content".to_string());
        fs::remove_file(file_path).unwrap();
    }

    #[test]
    fn test_readdir_sync() {
        let app = mock_app();
        let path = "file://test_readdir_sync_dir";
        let dir_path = get_jan_data_folder_path(app.handle().clone()).join(path);
        fs::create_dir_all(&dir_path).unwrap();
        File::create(dir_path.join("file1.txt")).unwrap();
        File::create(dir_path.join("file2.txt")).unwrap();

        let args = vec![dir_path.to_string_lossy().to_string()];
        let result = readdir_sync(app.handle().clone(), args).unwrap();
        assert_eq!(result.len(), 2);

        fs::remove_dir_all(dir_path).unwrap();
    }
}
