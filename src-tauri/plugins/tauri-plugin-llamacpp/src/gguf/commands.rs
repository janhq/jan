use super::helpers;
use super::types::GgufMetadata;
use reqwest;
use std::fs::File;
use std::io::BufReader;

/// Read GGUF metadata from a model file
#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        // Remote: read in 2MB chunks until successful
        let client = reqwest::Client::new();
        let chunk_size = 2 * 1024 * 1024; // Fixed 2MB chunks
        let max_total_size = 120 * 1024 * 1024; // Don't exceed 120MB total
        let mut total_downloaded = 0;
        let mut accumulated_data = Vec::new();

        while total_downloaded < max_total_size {
            let start = total_downloaded;
            let end = std::cmp::min(start + chunk_size - 1, max_total_size - 1);

            let resp = client
                .get(&path)
                .header("Range", format!("bytes={}-{}", start, end))
                .send()
                .await
                .map_err(|e| format!("Failed to fetch chunk {}-{}: {}", start, end, e))?;

            let chunk_data = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed to read chunk response: {}", e))?;

            accumulated_data.extend_from_slice(&chunk_data);
            total_downloaded += chunk_data.len();

            // Try parsing after each chunk
            let cursor = std::io::Cursor::new(&accumulated_data);
            if let Ok(metadata) = helpers::read_gguf_metadata(cursor) {
                return Ok(metadata);
            }

            // If we got less data than expected, we've reached EOF
            if chunk_data.len() < chunk_size {
                break;
            }
        }
        Err("Could not parse GGUF metadata from downloaded data".to_string())
    } else {
        // Local: use streaming file reader
        let file =
            File::open(&path).map_err(|e| format!("Failed to open local file {}: {}", path, e))?;
        let reader = BufReader::new(file);

        helpers::read_gguf_metadata(reader)
            .map_err(|e| format!("Failed to parse GGUF metadata: {}", e))
    }
}
