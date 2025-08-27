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
