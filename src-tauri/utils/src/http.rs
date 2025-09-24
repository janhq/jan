/// Checks if header name is a CORS-related header
pub fn is_cors_header(header_name: &str) -> bool {
    let header_lower = header_name.to_lowercase();
    header_lower.starts_with("access-control-")
}

/// Validates if host is in trusted hosts list
pub fn is_valid_host(host: &str, trusted_hosts: &[Vec<String>]) -> bool {
    if trusted_hosts.iter().any(|hosts| hosts.contains(&"*".to_string())) {
        return true;
    }

    if host.is_empty() {
        return false;
    }

    let host_without_port = if host.starts_with('[') {
        host.split(']')
            .next()
            .unwrap_or(host)
            .trim_start_matches('[')
    } else {
        host.split(':').next().unwrap_or(host)
    };
    let default_valid_hosts = ["localhost", "127.0.0.1", "0.0.0.0"];

    if default_valid_hosts
        .iter()
        .any(|&valid| host_without_port.to_lowercase() == valid.to_lowercase())
    {
        return true;
    }

    trusted_hosts.iter().flatten().any(|valid| {
        let host_lower = host.to_lowercase();
        let valid_lower = valid.to_lowercase();

        if host_lower == valid_lower {
            return true;
        }

        let valid_without_port = if valid.starts_with('[') {
            valid
                .split(']')
                .next()
                .unwrap_or(valid)
                .trim_start_matches('[')
        } else {
            valid.split(':').next().unwrap_or(valid)
        };

        host_without_port.to_lowercase() == valid_without_port.to_lowercase()
    })
}
