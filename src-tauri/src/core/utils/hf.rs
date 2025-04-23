use crate::core::state::AppState;
use crate::core::utils::download::{download, DownloadEvent, DownloadEventType};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

// task_id is only for compatibility with current Jan+Cortex we can remove it later
// should we disallow custom save_dir? i.e. all HF models will be downloaded to
// <app_dir>/models/<repo_id>/<branch>?
// (only cortexso uses branch. normally people don't use it)
#[tauri::command]
pub async fn download_hf_repo(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: &str,
    repo_id: &str,
    branch: &str,
    files: Option<Vec<String>>,
    save_dir: &Path,
) -> Result<(), String> {
    // TODO: check if it has been downloaded

    // check if task_id already exists i.e. being downloaded
    {
        let download_manager = state.download_manager.lock().await;
        if download_manager.cancel_tokens.contains_key(task_id) {
            return Err(format!("Task ID {} already exists", task_id));
        }
    }

    let mut file_infos = list_files(repo_id, branch)
        .await
        .map_err(|e| format!("Failed to list files {}", e))?;

    if let Some(files) = files {
        // validate files
        for file in &files {
            if !file_infos.iter().any(|info| info.path == *file) {
                return Err(format!("File {} does not exist", file));
            }
        }

        file_infos.retain(|info| files.contains(&info.path));
    }

    // obtain total download size. emit download started event
    let info = DownloadEvent {
        task_id: task_id.to_string(),
        total_size: file_infos.iter().map(|f| f.size).sum(),
        downloaded_size: 0,
        download_type: "Model".to_string(),
        event_type: DownloadEventType::Started,
    };
    let info_arc = Arc::new(Mutex::new(info));
    log::info!("Start download repo_id: {} branch: {}", repo_id, branch);
    app.emit("download", info_arc.lock().unwrap().clone())
        .unwrap();

    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }

    let download_result = async {
        // NOTE: currently we are downloading sequentially. we can spawn tokio tasks
        // to download files in parallel.
        for info in file_infos {
            let url = format!(
                "https://huggingface.co/{}/resolve/{}/{}",
                repo_id, branch, info.path
            );
            let full_path = save_dir.join(&info.path);

            // update download progress. clone app handle and info_arc
            // to move them into the closure
            let callback = {
                let app = app.clone();
                let info_arc = Arc::clone(&info_arc);
                move |size| {
                    let mut info = info_arc.lock().unwrap();
                    info.event_type = DownloadEventType::Updated;
                    info.downloaded_size += size;
                    app.emit("download", info.clone()).unwrap();
                }
            };
            download(&url, &full_path, Some(cancel_token.clone()), Some(callback))
                .await
                .map_err(|e| format!("Failed to download file {}: {}", info.path, e))?;
        }
        Ok(())
    }
    .await;

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
    }
    if (cancel_token.is_cancelled() || download_result.is_err()) && save_dir.exists() {
        // NOTE: we don't check error here
        let _ = std::fs::remove_dir_all(save_dir);
    }

    // report results
    match download_result {
        Ok(_) => {
            let mut info = info_arc.lock().unwrap();
            if cancel_token.is_cancelled() {
                info.event_type = DownloadEventType::Stopped;
                log::info!("Cancelled download repo_id: {} branch: {}", repo_id, branch);
            } else {
                info.event_type = DownloadEventType::Success;
                log::info!("Finished download repo_id: {} branch: {}", repo_id, branch);
            }
            app.emit("download", info.clone()).unwrap();
            Ok(())
        }
        Err(e) => {
            log::info!("Failed to download repo_id: {} branch: {}", repo_id, branch);
            // TODO: check what cortex and Jan does on download error
            // app.emit("download", info.clone()).unwrap();
            Err(e)
        }
    }
}

#[derive(Debug)]
struct FileInfo {
    path: String,
    size: u64,
}

async fn list_files(
    repo_id: &str,
    branch: &str,
) -> Result<Vec<FileInfo>, Box<dyn std::error::Error>> {
    let mut files = vec![];
    let client = reqwest::Client::new();

    // DFS with a stack (similar to recursion)
    let mut stack = vec!["".to_string()];
    while let Some(directory) = stack.pop() {
        let url = format!(
            "https://huggingface.co/api/models/{}/tree/{}/{}",
            repo_id, branch, directory
        );
        let resp = client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(format!(
                "Failed to list files: HTTP status {}, {}",
                resp.status(),
                resp.text().await?
            )
            .into());
        }

        // this struct is only used for internal deserialization
        #[derive(serde::Deserialize)]
        struct Item {
            r#type: String,
            path: String,
            size: u64,
        }
        for item in resp.json::<Vec<Item>>().await?.into_iter() {
            match item.r#type.as_str() {
                "file" => files.push(FileInfo {
                    path: item.path,
                    size: item.size,
                }),
                "directory" => stack.push(item.path),
                _ => {}
            }
        }
    }

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    // TODO: add test for download_hf_repo (need to find a small repo)
    // TODO: test when repo does not exist

    #[tokio::test]
    async fn test_list_files() {
        let repo_id = "openai-community/gpt2";
        let branch = "main";

        let result = list_files(repo_id, branch).await;
        assert!(result.is_ok(), "{}", result.unwrap_err());
        let files = result.unwrap();
        assert!(
            files.iter().any(|f| f.path == "config.json"),
            "config.json should be in the list"
        );
    }
}
