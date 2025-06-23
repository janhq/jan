use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// Represents the result of a Jan data folder validation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderValidationResult {
    pub is_valid_jan_folder: bool,
    pub is_empty: bool,
    pub has_important_data: bool,
    pub jan_specific_files: Vec<String>,
    pub folder_size_mb: f64,
    pub permissions_ok: bool,
    pub error_message: Option<String>,
    pub warnings: Vec<String>,
}

/// Jan-specific files and directories that indicate a valid Jan data folder
const JAN_SPECIFIC_ITEMS: &[&str] = &[
    "threads",
    "extensions",
    "models",
    "logs",
    "settings.json",
    "extensions.json",
];

/// Important data indicators that should trigger warnings
const IMPORTANT_DATA_INDICATORS: &[&str] = &[
    "threads",
    "models",
    "conversations",
    "chat_history",
];

/// Validates if a folder is a legitimate Jan data directory
pub fn validate_jan_data_folder<P: AsRef<Path>>(folder_path: P) -> FolderValidationResult {
    let path = folder_path.as_ref();
    
    // Initialize result
    let mut result = FolderValidationResult {
        is_valid_jan_folder: false,
        is_empty: true,
        has_important_data: false,
        jan_specific_files: Vec::new(),
        folder_size_mb: 0.0,
        permissions_ok: false,
        error_message: None,
        warnings: Vec::new(),
    };

    // Check if path exists and is accessible
    if !path.exists() {
        result.error_message = Some("Folder does not exist".to_string());
        return result;
    }

    if !path.is_dir() {
        result.error_message = Some("Path is not a directory".to_string());
        return result;
    }

    // Check permissions
    result.permissions_ok = check_folder_permissions(path);
    if !result.permissions_ok {
        result.warnings.push("Insufficient permissions to read/write folder".to_string());
    }

    // Read directory contents
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            result.error_message = Some(format!("Cannot read directory: {}", e));
            return result;
        }
    };

    let mut total_size = 0u64;
    let mut found_items = Vec::new();

    // Analyze directory contents
    for entry in entries {
        if let Ok(entry) = entry {
            let entry_path = entry.path();
            let entry_name = entry_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            found_items.push(entry_name.clone());

            // Check if it's a Jan-specific item
            if JAN_SPECIFIC_ITEMS.iter().any(|&item| item == entry_name) {
                result.jan_specific_files.push(entry_name.clone());
            }

            // Check for important data
            if IMPORTANT_DATA_INDICATORS.iter().any(|&item| item == entry_name) {
                result.has_important_data = true;
            }

            // Calculate size
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    total_size += metadata.len();
                } else if metadata.is_dir() {
                    total_size += calculate_dir_size(&entry_path).unwrap_or(0);
                }
            }
        }
    }

    // Determine if folder is empty
    result.is_empty = found_items.is_empty();

    // Calculate folder size in MB
    result.folder_size_mb = total_size as f64 / (1024.0 * 1024.0);

    // Determine if it's a valid Jan folder
    result.is_valid_jan_folder = result.jan_specific_files.len() >= 2 || 
        (result.jan_specific_files.len() >= 1 && result.has_important_data);

    // Add warnings based on analysis
    if result.has_important_data && result.folder_size_mb > 100.0 {
        result.warnings.push(format!(
            "Folder contains {:.1} MB of data that may include important conversations and models",
            result.folder_size_mb
        ));
    }

    if !result.is_valid_jan_folder && !result.is_empty {
        result.warnings.push("Folder does not appear to be a Jan data folder but contains files".to_string());
    }

    result
}

/// Validates a folder for factory reset operation
pub fn validate_factory_reset_target<P: AsRef<Path>>(folder_path: P) -> FolderValidationResult {
    let mut result = validate_jan_data_folder(folder_path.as_ref());
    
    // Additional validation for factory reset
    if !result.is_valid_jan_folder {
        result.warnings.push(
            "Warning: This does not appear to be a Jan data folder. Factory reset may delete unrelated data.".to_string()
        );
    }

    if result.has_important_data {
        result.warnings.push(
            "This folder contains important data (conversations, models, etc.) that will be permanently deleted.".to_string()
        );
    }

    result
}

/// Validates a target folder for data folder change operation
pub fn validate_folder_change_target<P: AsRef<Path>>(
    target_path: P,
    current_path: Option<P>,
) -> FolderValidationResult {
    let target = target_path.as_ref();
    
    // Initialize result with basic validation
    let mut result = FolderValidationResult {
        is_valid_jan_folder: false,
        is_empty: true,
        has_important_data: false,
        jan_specific_files: Vec::new(),
        folder_size_mb: 0.0,
        permissions_ok: false,
        error_message: None,
        warnings: Vec::new(),
    };

    // Rule 1: If empty path, it's ok (allow user to clear the data folder)
    let target_str = target.to_string_lossy().trim().to_string();
    if target_str.is_empty() {
        result.is_empty = true;
        result.permissions_ok = true;
        return result;
    }

    // Rule 2: Check for dangerous/root paths
    if is_dangerous_path(target) {
        result.error_message = Some(
            "Cannot use root directories or system paths as data folder. Please choose a safe user directory.".to_string()
        );
        return result;
    }

    // Rule 3: Check if path exists and validate it
    if !target.exists() {
        result.error_message = Some("Target folder does not exist".to_string());
        return result;
    }

    // Now perform full validation since path exists and is safe
    result = validate_jan_data_folder(target);

    // Check if target is the same as current
    if let Some(current) = current_path {
        if target == current.as_ref() {
            result.error_message = Some("Target folder is the same as current folder".to_string());
            return result;
        }

        // Check if target is a subdirectory of current
        if target.starts_with(current.as_ref()) {
            result.error_message = Some(
                "Target folder cannot be a subdirectory of the current data folder".to_string()
            );
            return result;
        }
    }

    // Additional warnings for folder change
    if result.is_valid_jan_folder && result.has_important_data {
        result.warnings.push(
            "Target folder already contains Jan data. Existing data may be overwritten.".to_string()
        );
    }

    if !result.is_empty && !result.is_valid_jan_folder {
        result.warnings.push(
            "Target folder contains non-Jan files that may be affected by the operation.".to_string()
        );
    }

    result
}

/// Checks if a path is a dangerous system path that should not be used as data folder
fn is_dangerous_path<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    let path_str = path.to_string_lossy().to_lowercase();
    
    // Check for exact dangerous paths
    let dangerous_paths = [
        "/", "/root", "/usr", "/etc", "/var", "/bin", "/sbin", "/boot", "/sys", "/proc",
        "c:", "c:/", "c:\\", "d:", "d:/", "d:\\", "e:", "e:/", "e:\\",
        "/system", "/library", "/applications", "/volumes",
        "/windows", "/program files", "/program files (x86)", "/programdata",
    ];
    
    for dangerous in &dangerous_paths {
        if path_str == *dangerous || path_str == format!("{}\\", dangerous) || path_str == format!("{}/", dangerous) {
            return true;
        }
    }
    
    // Check if path is a direct child of dangerous directories
    let dangerous_parents = [
        "/", "/root", "/usr", "/etc", "/var", "/bin", "/sbin", "/boot",
        "c:\\", "d:\\", "e:\\", "/system", "/library", "/windows",
    ];
    
    for dangerous_parent in &dangerous_parents {
        let normalized_parent = dangerous_parent.replace('\\', "/");
        let normalized_path = path_str.replace('\\', "/");
        
        if normalized_path.starts_with(&normalized_parent) {
            // Check if it's a direct child (not nested deeper)
            let relative_path = normalized_path.strip_prefix(&normalized_parent).unwrap_or("");
            if !relative_path.is_empty() && !relative_path.contains('/') {
                return true;
            }
        }
    }
    
    false
}

/// Checks if the folder has proper read/write permissions
fn check_folder_permissions<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    
    // Try to create a temporary file to test write permissions
    let test_file = path.join(".jan_permission_test");
    let write_ok = fs::write(&test_file, "test").is_ok();
    
    if write_ok {
        let _ = fs::remove_file(&test_file);
    }

    // Check read permissions by trying to read the directory
    let read_ok = fs::read_dir(path).is_ok();

    read_ok && write_ok
}

/// Recursively calculates directory size
fn calculate_dir_size<P: AsRef<Path>>(path: P) -> Result<u64, std::io::Error> {
    let mut total_size = 0u64;
    
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        
        if metadata.is_file() {
            total_size += metadata.len();
        } else if metadata.is_dir() {
            total_size += calculate_dir_size(entry.path())?;
        }
    }
    
    Ok(total_size)
}

/// Creates a summary report for validation results
pub fn create_validation_summary(result: &FolderValidationResult) -> String {
    let mut summary = Vec::new();
    
    if let Some(error) = &result.error_message {
        summary.push(format!("❌ Error: {}", error));
        return summary.join("\n");
    }

    summary.push(format!("📁 Folder Analysis:"));
    summary.push(format!("   • Valid Jan folder: {}", if result.is_valid_jan_folder { "✅ Yes" } else { "❌ No" }));
    summary.push(format!("   • Empty: {}", if result.is_empty { "✅ Yes" } else { "❌ No" }));
    summary.push(format!("   • Contains important data: {}", if result.has_important_data { "⚠️ Yes" } else { "✅ No" }));
    summary.push(format!("   • Size: {:.1} MB", result.folder_size_mb));
    summary.push(format!("   • Permissions: {}", if result.permissions_ok { "✅ OK" } else { "❌ Limited" }));

    if !result.jan_specific_files.is_empty() {
        summary.push(format!("   • Jan files found: {}", result.jan_specific_files.join(", ")));
    }

    if !result.warnings.is_empty() {
        summary.push(format!("\n⚠️ Warnings:"));
        for warning in &result.warnings {
            summary.push(format!("   • {}", warning));
        }
    }

    summary.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_empty_folder_validation() {
        let temp_dir = TempDir::new().unwrap();
        let result = validate_jan_data_folder(temp_dir.path());
        
        assert!(!result.is_valid_jan_folder);
        assert!(result.is_empty);
        assert!(!result.has_important_data);
        assert!(result.permissions_ok);
        assert!(result.error_message.is_none());
    }

    #[test]
    fn test_valid_jan_folder() {
        let temp_dir = TempDir::new().unwrap();
        let threads_dir = temp_dir.path().join("threads");
        let extensions_dir = temp_dir.path().join("extensions");
        
        fs::create_dir(&threads_dir).unwrap();
        fs::create_dir(&extensions_dir).unwrap();
        fs::write(temp_dir.path().join("settings.json"), "{}").unwrap();
        
        let result = validate_jan_data_folder(temp_dir.path());
        
        assert!(result.is_valid_jan_folder);
        assert!(!result.is_empty);
        assert!(result.has_important_data);
        assert!(result.jan_specific_files.contains(&"threads".to_string()));
        assert!(result.jan_specific_files.contains(&"extensions".to_string()));
    }

    #[test]
    fn test_non_jan_folder_with_files() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("random_file.txt"), "content").unwrap();
        
        let result = validate_jan_data_folder(temp_dir.path());
        
        assert!(!result.is_valid_jan_folder);
        assert!(!result.is_empty);
        assert!(!result.has_important_data);
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn test_empty_path_validation() {
        let result = validate_folder_change_target("", None::<&str>);
        
        assert!(result.is_empty);
        assert!(result.permissions_ok);
        assert!(result.error_message.is_none());
    }

    #[test]
    fn test_dangerous_path_validation() {
        // Test root paths
        let dangerous_paths = [
            "/", "/root", "/usr", "/etc", "/var",
            "C:", "C:/", "C:\\", "D:", "D:/", "D:\\",
            "/System", "/Library", "/Windows",
        ];
        
        for path in &dangerous_paths {
            assert!(is_dangerous_path(path), "Path {path} should be considered dangerous");
        }
    }

    #[test]
    fn test_safe_path_validation() {
        let safe_paths = [
            "/Users/username/Documents/jan-data",
            "/home/user/jan-data",
            "C:\\Users\\username\\Documents\\jan-data",
            "/Users/username/Desktop/my-jan-folder",
            "/Users/jan/Library/Application Support/Jan/data",
            "/Users/username/Library/Application Support/Jan",
            "C:\\Users\\username\\AppData\\Roaming\\Jan\\data",
            "/home/user/.local/share/Jan/data",
        ];
        
        for path in &safe_paths {
            assert!(!is_dangerous_path(path), "Path {path} should be considered safe");
        }
    }

    #[test]
    fn test_folder_change_validation_with_dangerous_path() {
        let result = validate_folder_change_target("/", None::<&str>);
        
        assert!(result.error_message.is_some());
        assert!(result.error_message.as_ref().unwrap().contains("root directories"));
    }
}