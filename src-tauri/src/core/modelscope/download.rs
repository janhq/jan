use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use tauri::Emitter;

use super::models::{ModelScopeBatchDownloadRequest, ModelScopeDownloadRecord};

const MAX_CONCURRENT: usize = 3;

/// Execute a batch download of ModelScope model files.
pub async fn execute_batch_download(
    request: ModelScopeBatchDownloadRequest,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!(
        "[modelscope] Batch download start: model_id={} file_path={:?} quant_dir={:?} save_dir={} save_name={:?}",
        request.model_id, request.file_path, request.quant_dir, request.save_dir, request.save_name
    );

    // 1. Fetch file list
    let file_list = super::commands::get_modelscope_model_files(request.model_id.clone())
        .await
        .map_err(|e| {
            log::error!(
                "[modelscope] Failed to fetch file list for {}: {}",
                request.model_id,
                e
            );
            e
        })?;

    // 2. Filter target files
    let target_files: Vec<_> = if let Some(ref file_path) = request.file_path {
        // Single-file mode: find the exact file
        file_list
            .Files
            .into_iter()
            .filter(|f| f.Path == *file_path)
            .collect()
    } else {
        // Batch mode: filter by quant_dir
        file_list
            .Files
            .into_iter()
            .filter(|f| {
                if f.Type == "tree" {
                    return false;
                }
                // Only download GGUF artifacts; skip README, imatrix, etc.
                if !f.Path.to_lowercase().ends_with(".gguf") {
                    return false;
                }
                match &request.quant_dir {
                    Some(dir) => f.Path.starts_with(&format!("{}/", dir)),
                    None => true,
                }
            })
            .collect()
    };

    let total_count = target_files.len();
    if total_count == 0 {
        log::warn!(
            "[modelscope] No matching files for model_id={} file_path={:?} quant_dir={:?}",
            request.model_id,
            request.file_path,
            request.quant_dir
        );
        return Err("No matching files to download".to_string());
    }

    let total_size_bytes: u64 = target_files.iter().map(|f| f.Size as u64).sum();
    log::info!(
        "[modelscope] {} files to download, total size={} bytes",
        total_count,
        total_size_bytes
    );

    // 3. Ensure save directory exists
    tokio::fs::create_dir_all(&request.save_dir)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Download files with concurrency limit
    let completed = Arc::new(AtomicUsize::new(0));

    let save_name = request.save_name.clone();
    let download_futures = target_files.into_iter().map(|file| {
        let app = app.clone();
        let save_dir = request.save_dir.clone();
        let model_id = request.model_id.clone();
        let save_name = save_name.clone();
        let completed = completed.clone();

        async move {
            let url = format!(
                "https://www.modelscope.cn/models/{}/resolve/master/{}",
                model_id, file.Path
            );
            let dest = if let Some(save_name) = save_name {
                std::path::PathBuf::from(&save_dir).join(save_name)
            } else {
                std::path::PathBuf::from(&save_dir).join(&file.Path)
            };

            // Create parent directories for the destination file
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }

            download_single_file(&url, &dest).await?;

            // Emit progress event after each file completes
            let count = completed.fetch_add(1, Ordering::SeqCst) + 1;
            app.emit(
                "modelscope-download-progress",
                serde_json::json!({
                    "completed": count,
                    "total": total_count,
                    "current_file": file.Name,
                }),
            )
            .ok();

            Ok::<(), String>(())
        }
    });

    let results: Vec<Result<(), String>> = stream::iter(download_futures)
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    // 5. Error handling
    let failed_count = results.iter().filter(|r| r.is_err()).count();
    if failed_count > 0 {
        let err = format!(
            "{} of {} files failed to download",
            failed_count, total_count
        );
        log::error!("[modelscope] {}", err);
        return Err(err);
    }
    log::info!(
        "[modelscope] All {} files downloaded successfully",
        total_count
    );

    // 6. Update download config (stub for now)
    let record = ModelScopeDownloadRecord {
        model_id: request.model_id,
        quant_dir: request.quant_dir,
        save_dir: request.save_dir,
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        files_count: total_count,
        total_size_bytes,
    };
    update_download_config(app, record).await?;

    Ok(())
}

/// Download a single file from URL to destination using streaming.
async fn download_single_file(url: &str, dest: &std::path::PathBuf) -> Result<(), String> {
    log::info!(
        "[modelscope] Starting download: url={} dest={}",
        url,
        dest.display()
    );

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| {
            log::error!("[modelscope] Failed to build HTTP client: {}", e);
            e.to_string()
        })?;

    let response = client.get(url).send().await.map_err(|e| {
        log::error!("[modelscope] HTTP request failed for {}: {}", url, e);
        e.to_string()
    })?;

    if !response.status().is_success() {
        let err = format!("HTTP {} for {}", response.status(), url);
        log::error!("[modelscope] {}", err);
        return Err(err);
    }

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| {
        log::error!(
            "[modelscope] Failed to create file {}: {}",
            dest.display(),
            e
        );
        e.to_string()
    })?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            log::error!("[modelscope] Stream error for {}: {}", url, e);
            e.to_string()
        })?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| {
                log::error!("[modelscope] Write error for {}: {}", dest.display(), e);
                e.to_string()
            })?;
    }

    log::info!("[modelscope] Download completed: {}", dest.display());
    Ok(())
}

/// Update download config with a new record.
/// Currently a stub; full persistence will be implemented later.
async fn update_download_config(
    _app: tauri::AppHandle,
    _record: ModelScopeDownloadRecord,
) -> Result<(), String> {
    Ok(())
}
