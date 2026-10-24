//! Permission strings and the network rule, mirroring `permissions.ts` in
//! `@janhq/extension-api` and `matchesNetwork` in the web-app dispatcher.

use url::Url;

const FIXED_PERMISSIONS: &[&str] = &[
    "ui:notify",
    "commands:execute",
    "providers",
    "tools",
    "conversations:read",
    "conversations:write",
    "chat:hooks",
];

const NETWORK_PREFIX: &str = "network:";

fn is_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    !bytes.is_empty()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes[0] != b'-'
        && bytes[bytes.len() - 1] != b'-'
}

/// A host grant usable after `network:`: `*`, an exact lowercase host or a
/// subdomain wildcard `*.example.com`. No scheme, port or path.
pub fn is_network_host(host: &str) -> bool {
    if host == "*" {
        return true;
    }
    let rest = host.strip_prefix("*.").unwrap_or(host);
    rest.split('.').all(is_label)
}

/// Whether `value` is a well-formed permission string.
pub fn is_permission_string(value: &str) -> bool {
    match value.strip_prefix(NETWORK_PREFIX) {
        Some(host) => is_network_host(host),
        None => FIXED_PERMISSIONS.contains(&value),
    }
}

/// The host part of a `network:<host>` permission.
pub fn network_host_of(permission: &str) -> Option<&str> {
    permission.strip_prefix(NETWORK_PREFIX)
}

/// Whether the host grant covers the URL host. `*.example.com` covers
/// subdomains only, never the apex.
pub fn network_host_matches(grant: &str, host: &str) -> bool {
    if grant == "*" {
        return true;
    }
    if let Some(suffix) = grant.strip_prefix('*') {
        return host.ends_with(suffix) && host.len() > suffix.len();
    }
    grant == host
}

/// Hosts reachable over plain http; everything else must use https.
pub fn is_local_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1"
}

/// `matchesNetwork`: whether `grant` lets an extension reach `url`. https
/// only, http for localhost/127.0.0.1; no credentials in the URL; nothing
/// reaches Jan's own local API server port on a local host, whatever the
/// grant, because that server proxies with the user's provider keys.
pub fn matches_network(grant: &str, url: &Url, local_api_port: Option<u16>) -> bool {
    let Some(host_grant) = network_host_of(grant) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let scheme = url.scheme();
    if scheme != "https" && !(scheme == "http" && is_local_host(host)) {
        return false;
    }
    if let (Some(port), true) = (local_api_port, is_local_host(host)) {
        if url.port_or_known_default() == Some(port) {
            return false;
        }
    }
    network_host_matches(host_grant, host)
}

/// Whether any of `granted` lets an extension reach `url`.
pub fn url_allowed(granted: &[String], url: &Url, local_api_port: Option<u16>) -> bool {
    granted
        .iter()
        .any(|g| matches_network(g, url, local_api_port))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(grant: &str, url: &str, port: Option<u16>) -> bool {
        matches_network(grant, &Url::parse(url).unwrap(), port)
    }

    #[test]
    fn permission_grammar() {
        for good in [
            "ui:notify",
            "network:*",
            "network:*.example.com",
            "network:api.example.com",
            "network:127.0.0.1",
            "network:localhost",
        ] {
            assert!(is_permission_string(good), "{good}");
        }
        for bad in [
            "network:",
            "network:Example.com",
            "network:a.com:443",
            "network:https://a.com",
            "network:-a.com",
            "network:a..com",
            "network:*.*.a.com",
            "fs:read",
            "",
        ] {
            assert!(!is_permission_string(bad), "{bad}");
        }
    }

    #[test]
    fn host_matching() {
        assert!(network_host_matches("*.example.com", "api.example.com"));
        assert!(!network_host_matches("*.example.com", "example.com"));
        assert!(!network_host_matches("*.example.com", "badexample.com"));
        assert!(network_host_matches("api.example.com", "api.example.com"));
        assert!(network_host_matches("*", "anything"));
    }

    #[test]
    fn scheme_credentials_and_local_port() {
        assert!(allowed("network:a.com", "https://a.com/x", None));
        assert!(!allowed("network:a.com", "http://a.com/x", None));
        assert!(allowed("network:127.0.0.1", "http://127.0.0.1:8080/", Some(1337)));
        assert!(!allowed("network:127.0.0.1", "http://127.0.0.1:1337/", Some(1337)));
        assert!(!allowed("network:*", "http://localhost:1337/v1", Some(1337)));
        assert!(!allowed("network:localhost", "http://localhost/", Some(80)));
        assert!(!allowed("network:a.com", "https://u:p@a.com/", None));
        assert!(!allowed("ui:notify", "https://a.com/", None));
        assert!(!allowed("network:*", "file:///etc/passwd", None));
    }
}
