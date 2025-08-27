use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use crate::path::validate_binary_path;
use jan_utils::{setup_library_path, setup_windows_process_flags};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub mem: i32,
    pub free: i32,
}

pub async fn get_devices_from_backend(
    backend_path: &str,
    library_path: Option<&str>,
    envs: HashMap<String, String>,
) -> ServerResult<Vec<DeviceInfo>> {
    log::info!("Getting devices from server at path: {:?}", backend_path);

    validate_binary_path(backend_path)?;

    // Configure the command to run the server with --list-devices
    let mut command = Command::new(backend_path);
    command.arg("--list-devices");
    command.envs(envs);

    // Set up library path
    setup_library_path(library_path, &mut command);

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    setup_windows_process_flags(&mut command);

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
