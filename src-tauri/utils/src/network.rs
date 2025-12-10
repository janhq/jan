use rand::{rngs::StdRng, Rng, SeedableRng};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::{HashMap, HashSet};
use url::Url;

#[derive(serde::Deserialize, Clone, Debug)]
pub struct ProxyConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub no_proxy: Option<Vec<String>>, // List of domains to bypass proxy
    pub ignore_ssl: Option<bool>,      // Ignore SSL certificate verification
}

/// Check if a port is available for binding
pub fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Generate a random port that's not in the used_ports set and is available
pub fn generate_random_port(used_ports: &HashSet<u16>) -> Result<u16, String> {
    const MAX_ATTEMPTS: u32 = 20000;
    let mut attempts = 0;
    let mut rng = StdRng::from_entropy();

    while attempts < MAX_ATTEMPTS {
        let port = rng.gen_range(3000..4000);

        if used_ports.contains(&port) {
            attempts += 1;
            continue;
        }

        if is_port_available(port) {
            return Ok(port);
        }

        attempts += 1;
    }

    Err("Failed to find an available port for the model to load".into())
}

/// Validates proxy configuration including URL format, scheme, authentication, and no_proxy entries
pub fn validate_proxy_config(config: &ProxyConfig) -> Result<(), String> {
    // Validate proxy URL format
    if let Err(e) = Url::parse(&config.url) {
        return Err(format!("Invalid proxy URL '{}': {}", config.url, e));
    }

    // Check if proxy URL has valid scheme
    let url = Url::parse(&config.url).unwrap(); // Safe to unwrap as we just validated it
    match url.scheme() {
        "http" | "https" | "socks4" | "socks5" => {}
        scheme => return Err(format!("Unsupported proxy scheme: {}", scheme)),
    }

    // Validate authentication credentials
    if config.username.is_some() && config.password.is_none() {
        return Err("Username provided without password".to_string());
    }

    if config.password.is_some() && config.username.is_none() {
        return Err("Password provided without username".to_string());
    }

    // Validate no_proxy entries
    if let Some(no_proxy) = &config.no_proxy {
        for entry in no_proxy {
            if entry.is_empty() {
                return Err("Empty no_proxy entry".to_string());
            }
            // Basic validation for wildcard patterns
            if entry.starts_with("*.") && entry.len() < 3 {
                return Err(format!("Invalid wildcard pattern: {}", entry));
            }
        }
    }

    // SSL verification settings are all optional booleans, no validation needed

    Ok(())
}

/// Checks if URL should bypass proxy based on no_proxy patterns (supports wildcards)
pub fn should_bypass_proxy(url: &str, no_proxy: &[String]) -> bool {
    if no_proxy.is_empty() {
        return false;
    }

    // Parse the URL to get the host
    let parsed_url = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => return false,
    };

    // Check if host matches any no_proxy entry
    for entry in no_proxy {
        if entry == "*" {
            return true;
        }

        // Simple wildcard matching
        if entry.starts_with("*.") {
            let domain = &entry[2..];
            if host.ends_with(domain) {
                return true;
            }
        } else if host == entry {
            return true;
        }
    }

    false
}

/// Creates reqwest::Proxy from ProxyConfig with authentication
pub fn create_proxy_from_config(config: &ProxyConfig) -> Result<reqwest::Proxy, String> {
    // Validate the configuration first
    validate_proxy_config(config)?;

    let mut proxy = reqwest::Proxy::all(&config.url).map_err(|e| format!("Error: {}", e))?;

    // Add authentication if provided
    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(proxy)
}

/// Converts HashMap<String,String> to reqwest HeaderMap
pub fn convert_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut header_map = HeaderMap::new();
    for (k, v) in headers {
        let key = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(v)?;
        header_map.insert(key, value);
    }
    Ok(header_map)
}

/// Information about a process using a specific port
#[derive(Debug, Clone)]
pub struct ProcessUsingPort {
    pub pid: u32,
    pub name: String,
    pub cmd: Vec<String>,
}

/// Find the process ID using a specific port
/// Returns None if port is available or process cannot be determined
pub fn find_process_using_port(port: u16) -> Option<ProcessUsingPort> {
    #[cfg(target_os = "macos")]
    {
        find_process_using_port_unix(port)
    }

    #[cfg(target_os = "linux")]
    {
        find_process_using_port_unix(port)
    }

    #[cfg(target_os = "windows")]
    {
        find_process_using_port_windows(port)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn find_process_using_port_unix(port: u16) -> Option<ProcessUsingPort> {
    use std::process::Command;

    let output = Command::new("lsof")
        .args(&["-i", &format!(":{}", port)])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let output_str = String::from_utf8_lossy(&output.stdout);

    for line in output_str.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() > 9 {
            let name = parts[0].to_string();
            let pid_str = parts[1];
            let state = parts.get(9).map(|s| s.to_uppercase());

            if let Some(state_val) = state {
                if state_val.contains("LISTEN") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let cmd =
                            get_process_command_line(pid).unwrap_or_else(|| vec![name.clone()]);
                        return Some(ProcessUsingPort { pid, name, cmd });
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_process_using_port_windows(port: u16) -> Option<ProcessUsingPort> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("netstat");
    cmd.args(&["-ano"]);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd.output().ok()?;

    let output_str = String::from_utf8_lossy(&output.stdout);

    for line in output_str.lines() {
        if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid_str) = parts.last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    let mut tasklist_cmd = Command::new("tasklist");
                    tasklist_cmd.args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"]);

                    #[cfg(windows)]
                    tasklist_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

                    let name_output = tasklist_cmd.output().ok()?;

                    let name_str = String::from_utf8_lossy(&name_output.stdout);
                    let name = name_str
                        .split(',')
                        .next()
                        .unwrap_or("Unknown")
                        .trim_matches('"')
                        .to_string();

                    let cmd = get_process_command_line(pid).unwrap_or_else(|| vec![name.clone()]);

                    return Some(ProcessUsingPort { pid, name, cmd });
                }
            }
        }
    }

    None
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn get_process_command_line(pid: u32) -> Option<Vec<String>> {
    use std::process::Command;

    let output = Command::new("ps")
        .args(&["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let cmd_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if cmd_str.is_empty() {
        return None;
    }

    Some(cmd_str.split_whitespace().map(|s| s.to_string()).collect())
}

#[cfg(target_os = "windows")]
fn get_process_command_line(pid: u32) -> Option<Vec<String>> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("wmic");
    cmd.args(&[
        "process",
        "where",
        &format!("ProcessId={}", pid),
        "get",
        "CommandLine",
        "/format:list",
    ]);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd.output().ok()?;

    if !output.status.success() {
        return None;
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    for line in output_str.lines() {
        if line.starts_with("CommandLine=") {
            let cmd_str = line.strip_prefix("CommandLine=")?.trim().to_string();
            if !cmd_str.is_empty() {
                return Some(cmd_str.split_whitespace().map(|s| s.to_string()).collect());
            }
        }
    }

    None
}

/// Get process information by PID
/// Returns None if process doesn't exist or cannot be determined
pub fn get_process_info_by_pid(pid: u32) -> Option<ProcessUsingPort> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        get_process_info_by_pid_unix(pid)
    }

    #[cfg(target_os = "windows")]
    {
        get_process_info_by_pid_windows(pid)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn get_process_info_by_pid_unix(pid: u32) -> Option<ProcessUsingPort> {
    use std::process::Command;

    // Use ps to get process info by PID
    let output = Command::new("ps")
        .args(&["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        return None;
    }

    let cmd = get_process_command_line(pid).unwrap_or_else(|| vec![name.clone()]);

    Some(ProcessUsingPort { pid, name, cmd })
}

#[cfg(target_os = "windows")]
fn get_process_info_by_pid_windows(pid: u32) -> Option<ProcessUsingPort> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    // Use wmic to get process info by PID
    let mut cmd = Command::new("wmic");
    cmd.args(&[
        "process",
        "where",
        &format!("ProcessId={}", pid),
        "get",
        "Name",
        "/format:list",
    ]);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd.output().ok()?;

    if !output.status.success() {
        return None;
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut name = String::new();

    for line in output_str.lines() {
        if line.starts_with("Name=") {
            name = line.strip_prefix("Name=")?.trim().to_string();
            break;
        }
    }

    if name.is_empty() {
        return None;
    }

    let cmd = get_process_command_line(pid).unwrap_or_else(|| vec![name.clone()]);

    Some(ProcessUsingPort { pid, name, cmd })
}

pub fn is_orphaned_mcp_process(process_info: &ProcessUsingPort) -> bool {
    let name_lower = process_info.name.to_lowercase();
    let cmd_str = process_info.cmd.join(" ").to_lowercase();

    let is_js_runtime =
        name_lower.contains("node") || name_lower.contains("npx") || name_lower.contains("bun");
    let is_jan_mcp_server = cmd_str.contains("search-mcp-server")
        || (cmd_str.contains("jan") && cmd_str.contains("mcp"))
        || cmd_str.contains("node")
        || cmd_str.contains("bun");

    is_js_runtime && is_jan_mcp_server
}
