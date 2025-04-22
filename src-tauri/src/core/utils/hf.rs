use std::path::Path;

pub async fn download_file(
    repo_id: &str,
    branch: &str,
    file_path: &str,
    save_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        repo_id, branch, file_path
    );
    super::download::download(&url, save_path).await
}

pub async fn list_files(
    repo_id: &str,
    branch: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut files = vec![];
    let client = reqwest::Client::new();

    // do recursion with a stack
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

        #[derive(serde::Deserialize)]
        struct Item {
            r#type: String,
            path: String,
        }
        for item in resp.json::<Vec<Item>>().await?.into_iter() {
            match item.r#type.as_str() {
                "file" => files.push(item.path),
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

    #[tokio::test]
    async fn test_download_file() {
        let repo_id = "openai-community/gpt2";
        let branch = "main";
        let file_path = "config.json";
        let save_path = std::path::PathBuf::from("subdir/test_config.json");

        if let Some(parent) = save_path.parent() {
            if parent.exists() {
                std::fs::remove_dir_all(parent).unwrap();
            }
        }

        let result = download_file(repo_id, branch, file_path, &save_path).await;
        assert!(result.is_ok(), "{}", result.unwrap_err());
        assert!(save_path.exists());

        // Read the file and verify its content
        let file_content = std::fs::read_to_string(&save_path).unwrap();
        let json_result: Result<serde_json::Value, _> = serde_json::from_str(&file_content);
        assert!(json_result.is_ok(), "Downloaded file is not valid JSON");

        if let Ok(json) = json_result {
            assert!(json.is_object(), "JSON root should be an object");
            assert_eq!(
                json.get("model_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                "gpt2",
                "model_type should be gpt2"
            );
        }

        // Clean up
        // NOTE: this will not run if there are errors
        // TODO: use tempfile crate instead
        std::fs::remove_dir_all(save_path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn test_list_files() {
        let repo_id = "openai-community/gpt2";
        let branch = "main";

        let result = list_files(repo_id, branch).await;
        assert!(result.is_ok(), "{}", result.unwrap_err());
        let files = result.unwrap();
        assert!(
            files.iter().any(|f| f == "config.json"),
            "config.json should be in the list"
        );
    }
}
