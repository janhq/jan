use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use crate::path::validate_binary_path;
use jan_utils::{add_cuda_paths, binary_requires_cuda, setup_library_path, setup_windows_process_flags};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub mem: i32,
    pub free: i32,
}

pub async fn get_devices_from_backend(
    backend_path: &str,
    envs: HashMap<String, String>,
) -> ServerResult<Vec<DeviceInfo>> {
    log::info!("Getting devices from server at path: {:?}", backend_path);

    let bin_path = validate_binary_path(backend_path)?;

    // Configure the command to run the server with --list-devices
    let mut command = Command::new(&bin_path);
    command.arg("--list-devices");
    command.envs(envs);

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    setup_windows_process_flags(&mut command);
    // Try to add CUDA paths (works on both Windows and Linux)
    let cuda_found = add_cuda_paths(&mut command);

    // Optionally check if binary needs CUDA
    if !cuda_found && binary_requires_cuda(&bin_path) {
        log::warn!(
            "llama.cpp backend appears to require CUDA, but CUDA not found. Process may fail to start. Please install cuda runtime and try again!"
        );
    }

    // Add the binary's directory to library path
    setup_library_path(bin_path.parent(), &mut command);

    // Execute the command and wait for completion
    let output = timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| {
            LlamacppError::new(
                ErrorCode::InternalError,
                "Timeout waiting for device list".into(),
                None,
            )
        })?
        .map_err(ServerError::Io)?;

    // Check if command executed successfully
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("llama-server --list-devices failed: {}", stderr);
        return Err(LlamacppError::from_stderr(&stderr).into());
    }
    // Parse the output
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::info!("Device list output:\n{}", stdout);

    parse_device_output(&stdout)
}

fn parse_device_output(output: &str) -> ServerResult<Vec<DeviceInfo>> {
    let mut devices = Vec::new();
    let mut found_devices_section = false;

    for raw in output.lines() {
        // detect header (ignoring whitespace)
        if raw.trim() == "Available devices:" {
            found_devices_section = true;
            continue;
        }

        if !found_devices_section {
            continue;
        }

        // skip blank lines
        if raw.trim().is_empty() {
            continue;
        }

        // now parse any non-blank line after the header
        let line = raw.trim();
        if let Some(device) = parse_device_line(line)? {
            devices.push(device);
        }
    }

    if devices.is_empty() && found_devices_section {
        log::warn!("No devices found in output");
    } else if !found_devices_section {
        return Err(LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            "Could not find 'Available devices:' section in the backend output.".into(),
            Some(output.to_string()),
        )
        .into());
    }

    Ok(devices)
}

fn parse_device_line(line: &str) -> ServerResult<Option<DeviceInfo>> {
    let line = line.trim();

    log::info!("Parsing device line: '{}'", line);

    // Expected formats:
    // "Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)"
    // "CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)"
    // "SYCL0: Intel(R) Arc(TM) A750 Graphics (8000 MiB, 7721 MiB free)"

    // Split by colon to get ID and rest
    let parts: Vec<&str> = line.splitn(2, ':').collect();
    if parts.len() != 2 {
        log::warn!("Skipping malformed device line: {}", line);
        return Ok(None);
    }

    let id = parts[0].trim().to_string();
    let rest = parts[1].trim();

    // Use regex-like approach to find the memory pattern at the end
    // Look for pattern: (number MiB, number MiB free) at the end
    if let Some(memory_match) = find_memory_pattern(rest) {
        let (memory_start, memory_content) = memory_match;
        let name = rest[..memory_start].trim().to_string();

        // Parse memory info: "8128 MiB, 8128 MiB free"
        let memory_parts: Vec<&str> = memory_content.split(',').collect();
        if memory_parts.len() >= 2 {
            if let (Ok(total_mem), Ok(free_mem)) = (
                parse_memory_value(memory_parts[0].trim()),
                parse_memory_value(memory_parts[1].trim()),
            ) {
                log::info!(
                    "Parsed device - ID: '{}', Name: '{}', Mem: {}, Free: {}",
                    id,
                    name,
                    total_mem,
                    free_mem
                );

                return Ok(Some(DeviceInfo {
                    id,
                    name,
                    mem: total_mem,
                    free: free_mem,
                }));
            }
        }
    }

    log::warn!("Could not parse device line: {}", line);
    Ok(None)
}

fn find_memory_pattern(text: &str) -> Option<(usize, &str)> {
    // Find the last parenthesis that contains the memory pattern
    let mut last_match = None;
    let mut chars = text.char_indices().peekable();

    while let Some((start_idx, ch)) = chars.next() {
        if ch == '(' {
            // Find the closing parenthesis
            let remaining = &text[start_idx + 1..];
            if let Some(close_pos) = remaining.find(')') {
                let content = &remaining[..close_pos];

                // Check if this looks like memory info
                if is_memory_pattern(content) {
                    last_match = Some((start_idx, content));
                }
            }
        }
    }

    last_match
}

fn is_memory_pattern(content: &str) -> bool {
    // Check if content matches pattern like "8128 MiB, 8128 MiB free"
    // Must contain: numbers, "MiB", comma, "free"
    if !(content.contains("MiB") && content.contains("free") && content.contains(',')) {
        return false;
    }

    let parts: Vec<&str> = content.split(',').collect();
    if parts.len() != 2 {
        return false;
    }

    parts.iter().all(|part| {
        let part = part.trim();
        // Each part should start with a number and contain "MiB"
        part.split_whitespace()
            .next()
            .map_or(false, |first_word| first_word.parse::<i32>().is_ok())
            && part.contains("MiB")
    })
}

fn parse_memory_value(mem_str: &str) -> ServerResult<i32> {
    // Handle formats like "8000 MiB" or "7721 MiB free"
    let parts: Vec<&str> = mem_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err(LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            format!("empty memory value: {}", mem_str),
            None,
        )
        .into());
    }

    // Take the first part which should be the number
    let number_str = parts[0];
    number_str.parse::<i32>().map_err(|_| {
        LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            format!("Could not parse memory value: '{}'", number_str),
            None,
        )
        .into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_memory_pattern_valid() {
        assert!(is_memory_pattern("8128 MiB, 8128 MiB free"));
        assert!(is_memory_pattern("1024 MiB, 512 MiB free"));
        assert!(is_memory_pattern("16384 MiB, 12000 MiB free"));
        assert!(is_memory_pattern("0 MiB, 0 MiB free"));
    }

    #[test]
    fn test_is_memory_pattern_invalid() {
        assert!(!is_memory_pattern("8128 MB, 8128 MB free")); // Wrong unit
        assert!(!is_memory_pattern("8128 MiB 8128 MiB free")); // Missing comma
        assert!(!is_memory_pattern("8128 MiB, 8128 MiB used")); // Wrong second part
        assert!(!is_memory_pattern("not_a_number MiB, 8128 MiB free")); // Invalid number
        assert!(!is_memory_pattern("8128 MiB")); // Missing second part
        assert!(!is_memory_pattern("")); // Empty string
        assert!(!is_memory_pattern("8128 MiB, free")); // Missing number in second part
    }

    #[test]
    fn test_find_memory_pattern() {
        let text = "Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 4096 MiB free)";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (start_idx, content) = result.unwrap();
        assert!(start_idx > 0);
        assert_eq!(content, "8128 MiB, 4096 MiB free");
    }

    #[test]
    fn test_find_memory_pattern_multiple_parentheses() {
        let text = "Device (test) with (1024 MiB, 512 MiB free) and (2048 MiB, 1024 MiB free)";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (_, content) = result.unwrap();
        // Should return the LAST valid memory pattern
        assert_eq!(content, "2048 MiB, 1024 MiB free");
    }

    #[test]
    fn test_find_memory_pattern_no_match() {
        let text = "No memory info here";
        assert!(find_memory_pattern(text).is_none());

        let text_with_invalid = "Some text (invalid memory info) here";
        assert!(find_memory_pattern(text_with_invalid).is_none());
    }

    #[test]
    fn test_parse_memory_value() {
        assert_eq!(parse_memory_value("8128 MiB").unwrap(), 8128);
        assert_eq!(parse_memory_value("7721 MiB free").unwrap(), 7721);
        assert_eq!(parse_memory_value("0 MiB").unwrap(), 0);
        assert_eq!(parse_memory_value("24576 MiB").unwrap(), 24576);
    }

    #[test]
    fn test_parse_memory_value_invalid() {
        assert!(parse_memory_value("").is_err());
        assert!(parse_memory_value("not_a_number MiB").is_err());
        assert!(parse_memory_value("  ").is_err());
    }

    #[test]
    fn test_parse_device_line_vulkan() {
        let line = "Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)";
        let result = parse_device_line(line).unwrap();
        assert!(result.is_some());
        let device = result.unwrap();
        assert_eq!(device.id, "Vulkan0");
        assert_eq!(device.name, "Intel(R) Arc(tm) A750 Graphics (DG2)");
        assert_eq!(device.mem, 8128);
        assert_eq!(device.free, 8128);
    }

    #[test]
    fn test_parse_device_line_cuda() {
        let line = "CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)";
        let result = parse_device_line(line).unwrap();
        assert!(result.is_some());
        let device = result.unwrap();
        assert_eq!(device.id, "CUDA0");
        assert_eq!(device.name, "NVIDIA GeForce RTX 4090");
        assert_eq!(device.mem, 24576);
        assert_eq!(device.free, 24000);
    }

    #[test]
    fn test_parse_device_line_sycl() {
        let line = "SYCL0: Intel(R) Arc(TM) A750 Graphics (8000 MiB, 7721 MiB free)";
        let result = parse_device_line(line).unwrap();
        assert!(result.is_some());
        let device = result.unwrap();
        assert_eq!(device.id, "SYCL0");
        assert_eq!(device.name, "Intel(R) Arc(TM) A750 Graphics");
        assert_eq!(device.mem, 8000);
        assert_eq!(device.free, 7721);
    }

    #[test]
    fn test_parse_device_line_malformed() {
        // Missing colon
        let result = parse_device_line("Vulkan0 Intel Graphics (8128 MiB, 8128 MiB free)").unwrap();
        assert!(result.is_none());

        // Missing memory info
        let result = parse_device_line("Vulkan0: Intel Graphics").unwrap();
        assert!(result.is_none());

        // Invalid memory format
        let result = parse_device_line("Vulkan0: Intel Graphics (invalid memory)").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_device_output_valid() {
        let output = r#"
Some header text
Available devices:
Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)
CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)

SYCL0: Intel(R) Arc(TM) A750 Graphics (8000 MiB, 7721 MiB free)
Some footer text
"#;

        let result = parse_device_output(output).unwrap();
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].id, "Vulkan0");
        assert_eq!(result[0].name, "Intel(R) Arc(tm) A750 Graphics (DG2)");
        assert_eq!(result[0].mem, 8128);

        assert_eq!(result[1].id, "CUDA0");
        assert_eq!(result[1].name, "NVIDIA GeForce RTX 4090");
        assert_eq!(result[1].mem, 24576);

        assert_eq!(result[2].id, "SYCL0");
        assert_eq!(result[2].name, "Intel(R) Arc(TM) A750 Graphics");
        assert_eq!(result[2].mem, 8000);
    }

    #[test]
    fn test_parse_device_output_no_devices_section() {
        let output = "Some output without Available devices section";
        let result = parse_device_output(output);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_device_output_empty_devices() {
        let output = r#"
Some header text
Available devices:

Some footer text
"#;
        let result = parse_device_output(output).unwrap();
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_parse_device_output_mixed_valid_invalid() {
        let output = r#"
Available devices:
Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)
InvalidLine: No memory info
CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)
AnotherInvalid
"#;

        let result = parse_device_output(output).unwrap();
        assert_eq!(result.len(), 2); // Only valid lines should be parsed

        assert_eq!(result[0].id, "Vulkan0");
        assert_eq!(result[1].id, "CUDA0");
    }
}
