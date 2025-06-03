pub mod download;
pub mod extensions;

use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Runtime;

use super::cmd::get_jan_data_folder_path;

pub const THREADS_DIR: &str = "threads";
pub const THREADS_FILE: &str = "thread.json";
pub const MESSAGES_FILE: &str = "messages.jsonl";

pub fn get_data_dir<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    get_jan_data_folder_path(app_handle).join(THREADS_DIR)
}

pub fn get_thread_dir<R: Runtime>(app_handle: tauri::AppHandle<R>, thread_id: &str) -> PathBuf {
    get_data_dir(app_handle).join(thread_id)
}

pub fn get_thread_metadata_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> PathBuf {
    get_thread_dir(app_handle, thread_id).join(THREADS_FILE)
}

pub fn get_messages_path<R: Runtime>(app_handle: tauri::AppHandle<R>, thread_id: &str) -> PathBuf {
    get_thread_dir(app_handle, thread_id).join(MESSAGES_FILE)
}

pub fn ensure_data_dirs<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    let data_dir = get_data_dir(app_handle.clone());
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure_thread_dir_exists<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> Result<(), String> {
    ensure_data_dirs(app_handle.clone())?;
    let thread_dir = get_thread_dir(app_handle, thread_id);
    if !thread_dir.exists() {
        fs::create_dir(&thread_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// https://github.com/rust-lang/cargo/blob/rust-1.67.0/crates/cargo-util/src/paths.rs#L82-L107
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut components = path.components().peekable();
    let mut ret = if let Some(c @ Component::Prefix(..)) = components.peek().cloned() {
        components.next();
        PathBuf::from(c.as_os_str())
    } else {
        PathBuf::new()
    };

    for component in components {
        match component {
            Component::Prefix(..) => unreachable!(),
            Component::RootDir => {
                ret.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                ret.pop();
            }
            Component::Normal(c) => {
                ret.push(c);
            }
        }
    }
    ret
}

#[tauri::command]
pub fn write_yaml(
    app: tauri::AppHandle,
    data: serde_json::Value,
    save_path: &str,
) -> Result<(), String> {
    // TODO: have an internal function to check scope
    let jan_data_folder = get_jan_data_folder_path(app.clone());
    let save_path = normalize_path(&jan_data_folder.join(save_path));
    if !save_path.starts_with(&jan_data_folder) {
        return Err(format!(
            "Error: save path {} is not under jan_data_folder {}",
            save_path.to_string_lossy(),
            jan_data_folder.to_string_lossy(),
        ));
    }
    let file = fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    serde_yaml::to_writer(&mut writer, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_yaml(app: tauri::AppHandle, path: &str) -> Result<serde_json::Value, String> {
    let jan_data_folder = get_jan_data_folder_path(app.clone());
    let path = normalize_path(&jan_data_folder.join(path));
    if !path.starts_with(&jan_data_folder) {
        return Err(format!(
            "Error: path {} is not under jan_data_folder {}",
            path.to_string_lossy(),
            jan_data_folder.to_string_lossy(),
        ));
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let data: serde_json::Value = serde_yaml::from_reader(reader).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn decompress(app: tauri::AppHandle, path: &str, output_dir: &str) -> Result<(), String> {
    let jan_data_folder = get_jan_data_folder_path(app.clone());
    let path_buf = normalize_path(&jan_data_folder.join(path));
    if !path_buf.starts_with(&jan_data_folder) {
        return Err(format!(
            "Error: path {} is not under jan_data_folder {}",
            path_buf.to_string_lossy(),
            jan_data_folder.to_string_lossy(),
        ));
    }

    let output_dir_buf = normalize_path(&jan_data_folder.join(output_dir));
    if !output_dir_buf.starts_with(&jan_data_folder) {
        return Err(format!(
            "Error: output directory {} is not under jan_data_folder {}",
            output_dir_buf.to_string_lossy(),
            jan_data_folder.to_string_lossy(),
        ));
    }

    let file = fs::File::open(&path_buf).map_err(|e| e.to_string())?;
    if path.ends_with(".tar.gz") {
        let tar = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(tar);
        // NOTE: unpack() will not write files outside of output_dir
        // -> prevent path traversal
        archive.unpack(output_dir).map_err(|e| e.to_string())?;
    } else {
        return Err("Unsupported file format. Only .tar.gz is supported.".to_string());
    }

    Ok(())
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    match unsafe { libloading::Library::new(library) } {
        Ok(_) => true,
        Err(e) => {
            log::info!("Library {} is not available: {}", library, e);
            false
        }
    }
}
