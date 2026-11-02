/// Extracts the host (with port if present) from an Origin header value.
pub fn extract_host_from_origin(origin: &str) -> String {
    // Origin format: scheme "://" host [ ":" port ]
    if let Some(after_scheme) = origin.split("://").nth(1) {
        // Take everything up to the first '/' (path), if any
        after_scheme.split('/').next().unwrap_or(after_scheme).to_string()
    } else {
        origin.to_string()
    }
}

/// Checks if header name is a CORS-related header
pub fn is_cors_header(header_name: &str) -> bool {
    let header_lower = header_name.to_lowercase();
    header_lower.starts_with("access-control-")
}

/// Validates that a `Host` header names this server: loopback, a private-range
/// IP literal, `host.docker.internal`, or a hostname the user listed.
///
/// A `*` entry does not widen this. It means "any web page may call the API"
/// and is handled by `is_trusted_origin`; letting it also accept every `Host`
/// would switch off the check that refuses DNS-rebinding pages, which reach
/// the server under their own hostname.
pub fn is_valid_host(host: &str, trusted_hosts: &[Vec<String>]) -> bool {
    if host.is_empty() {
        return false;
    }

    let host_without_port = host_without_port(host);
    let default_valid_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"];

    if default_valid_hosts
        .iter()
        .any(|&valid| host_without_port.to_lowercase() == valid.to_lowercase())
    {
        return true;
    }

    // Accept a Host that is a literal loopback or private-range IP. This covers LAN
    // clients hitting a 0.0.0.0-bound server via http://192.168.x.x:port without
    // wildcarding the allowlist. DNS rebinding sends an attacker *hostname* in Host,
    // not an IP, so this does not reopen that hole.
    // ponytail: IPv4 private/link-local + any loopback; add IPv6 ULA (fc00::/7) if a
    // user reports it, since Ipv6Addr::is_unique_local is still unstable in std.
    if let Ok(ip) = host_without_port.parse::<std::net::IpAddr>() {
        let private = match ip {
            std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(_) => false,
        };
        if ip.is_loopback() || private {
            return true;
        }
    }

    host_in_trusted_list(host, trusted_hosts)
}

/// Strips the port (and IPv6 brackets) from a `host[:port]` authority.
fn host_without_port(host: &str) -> &str {
    if host.starts_with('[') {
        host.split(']')
            .next()
            .unwrap_or(host)
            .trim_start_matches('[')
    } else {
        host.split(':').next().unwrap_or(host)
    }
}

/// Whether `host` (with optional port) matches a bare-host entry the user put
/// in the Trusted Hosts list. Entries match on hostname; ports are ignored.
/// Scheme-qualified entries (e.g. "app://obsidian.md") are skipped: they only
/// apply to Origins, where the scheme is known (see `scheme_entry_matches`).
/// The `null` entry is skipped too: it opts in `Origin: null`, not a host.
fn host_in_trusted_list(host: &str, trusted_hosts: &[Vec<String>]) -> bool {
    let host_without_port = host_without_port(host);
    trusted_hosts
        .iter()
        .flatten()
        .filter(|valid| !valid.contains("://") && !valid.trim().eq_ignore_ascii_case("null"))
        .any(|valid| {
            let host_lower = host.to_lowercase();
            let valid_lower = valid.to_lowercase();

            if host_lower == valid_lower {
                return true;
            }

            let valid_without_port = self::host_without_port(valid);

            !valid_without_port.is_empty()
                && host_without_port.to_lowercase() == valid_without_port.to_lowercase()
        })
}

/// Whether a parsed origin (lowercase `scheme`, `authority`) matches a
/// scheme-qualified Trusted Hosts entry such as "app://obsidian.md" or
/// "http://localhost:3000/v1". The scheme and hostname must match; the port
/// must match too when the entry names one. Any path on the entry is ignored.
fn scheme_entry_matches(scheme: &str, authority: &str, entry: &str) -> bool {
    let Some((entry_scheme, rest)) = entry.trim().split_once("://") else {
        return false;
    };
    let entry_authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    if !entry_scheme.eq_ignore_ascii_case(scheme)
        || entry_authority.is_empty()
        || !is_valid_authority(entry_authority)
    {
        return false;
    }
    let entry_authority = entry_authority.to_ascii_lowercase();
    let entry_host = host_without_port(&entry_authority);
    if entry_host.len() == entry_authority.len()
        || (entry_authority.starts_with('[') && entry_authority.ends_with(']'))
    {
        // No port in the entry: any port on that scheme and host.
        host_without_port(authority) == entry_host
    } else {
        authority == entry_authority
    }
}

/// Whether `port` is a decimal port number in 1-65535.
fn is_valid_port(port: &str) -> bool {
    !port.is_empty()
        && port.bytes().all(|b| b.is_ascii_digit())
        && matches!(port.parse::<u32>(), Ok(1..=65535))
}

/// Whether `authority` is a host with an optional valid port: `host`,
/// `host:port`, `[v6]` or `[v6]:port`.
fn is_valid_authority(authority: &str) -> bool {
    let port = if let Some(rest) = authority.strip_prefix('[') {
        let Some((addr, after)) = rest.split_once(']') else {
            return false;
        };
        if addr.is_empty() {
            return false;
        }
        if after.is_empty() {
            return true;
        }
        match after.strip_prefix(':') {
            Some(port) => port,
            None => return false,
        }
    } else {
        match authority.split_once(':') {
            None => return !authority.is_empty(),
            Some((host, port)) if !host.is_empty() => port,
            Some(_) => return false,
        }
    };
    is_valid_port(port)
}

/// Splits a serialized origin into lowercase `(scheme, authority)`. Returns
/// None for `null`, anything with a path/query/userinfo, a port that is not a
/// number in 1-65535, or garbage.
fn parse_origin(origin: &str) -> Option<(String, String)> {
    let (scheme, authority) = origin.trim().split_once("://")?;
    if scheme.is_empty()
        || authority.is_empty()
        || authority.contains(['/', '?', '#', '@', ' ', '\\'])
        || !is_valid_authority(authority)
    {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), authority.to_ascii_lowercase()))
}

/// The Trusted Hosts entry that opts in an opaque origin: `null` for
/// `Origin: null`, `file://` for a `file://` origin. None for anything else.
fn opaque_origin_entry(origin: &str) -> Option<&'static str> {
    let origin = origin.trim();
    if origin.eq_ignore_ascii_case("null") {
        Some("null")
    } else if origin.eq_ignore_ascii_case("file://") {
        Some("file://")
    } else {
        None
    }
}

/// Whether the app's webview origin is `http(s)://tauri.localhost` on this
/// platform. Mirrors Tauri's `tauri_protocol_url` (and `core::navigation`):
/// only Windows and Android serve custom schemes from `<scheme>.localhost`;
/// elsewhere `tauri.localhost` is an ordinary hostname and not the app.
const TAURI_LOCALHOST_IS_APP: bool = cfg!(any(windows, target_os = "android"));

/// The origins that are trusted even with cross-origin requests turned off:
/// the app's own webview (`tauri://localhost`, or `http(s)://tauri.localhost`
/// on Windows and Android) and a page served by this server itself, i.e. an
/// `http(s)` origin whose authority equals `host_header`. Callers must pass a
/// `host_header` that has already been validated (or "" to skip the
/// same-origin case), otherwise a rebinding hostname would match itself.
pub fn is_same_or_app_origin(origin: &str, host_header: &str) -> bool {
    is_same_or_app_origin_on(origin, host_header, TAURI_LOCALHOST_IS_APP)
}

fn is_same_or_app_origin_on(origin: &str, host_header: &str, tauri_localhost_is_app: bool) -> bool {
    let Some((scheme, authority)) = parse_origin(origin) else {
        return false;
    };
    let is_http = scheme == "http" || scheme == "https";
    if (scheme == "tauri" && authority == "localhost")
        || (tauri_localhost_is_app && is_http && authority == "tauri.localhost")
    {
        return true;
    }
    is_http && !host_header.is_empty() && authority == host_header.to_ascii_lowercase()
}

/// Decides whether a browser `Origin` may call the local API server.
///
/// Unlike `is_valid_host` (which validates the `Host` header and accepts any
/// private-range IP so LAN clients can reach a 0.0.0.0 bind), an origin is
/// the page that issued the request, so only these are trusted:
/// - everything `is_same_or_app_origin` accepts;
/// - loopback pages: `http(s)://localhost`, `127.0.0.1`, `[::1]` on any port;
/// - a bare host the user listed in Trusted Hosts (any scheme, so a browser
///   extension id can be listed), a scheme-qualified entry such as
///   `app://obsidian.md` (that scheme and host only), or `*` there.
///
/// A private-range IP origin (another machine on the LAN) is NOT trusted
/// unless listed. The opaque origins `null` (sandboxed frames, some Electron
/// apps, local HTML files) and `file://` are trusted only when that exact
/// entry (`null` or `file://`) is listed. Anything malformed is untrusted.
pub fn is_trusted_origin(origin: &str, host_header: &str, trusted_hosts: &[Vec<String>]) -> bool {
    if trusted_hosts.iter().any(|hosts| hosts.iter().any(|h| h == "*")) {
        return true;
    }
    if let Some(entry) = opaque_origin_entry(origin) {
        return trusted_hosts
            .iter()
            .flatten()
            .any(|listed| listed.trim().eq_ignore_ascii_case(entry));
    }
    if is_same_or_app_origin(origin, host_header) {
        return true;
    }
    let Some((scheme, authority)) = parse_origin(origin) else {
        return false;
    };
    let is_http = scheme == "http" || scheme == "https";
    if is_http && matches!(host_without_port(&authority), "localhost" | "127.0.0.1" | "::1") {
        return true;
    }
    host_in_trusted_list(&authority, trusted_hosts)
        || trusted_hosts
            .iter()
            .flatten()
            .any(|entry| scheme_entry_matches(&scheme, &authority, entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario A from GHSA-x6p8-7cp8-c3p6: default bind, empty allowlist stays safe.
    #[test]
    fn default_empty_allowlist_is_safe() {
        let trusted: Vec<Vec<String>> = vec![vec![]];
        assert!(is_valid_host("127.0.0.1:1337", &trusted));
        assert!(!is_valid_host("evil-rebind.attacker.com", &trusted));
        // CORS path: origin host of https://evil.com must not be trusted.
        assert!(!is_valid_host(
            &extract_host_from_origin("https://evil.com"),
            &trusted
        ));
    }

    // Scenario B: 0.0.0.0 bind must NOT wildcard. The user's allowlist is enforced;
    // attacker hostnames/origins are rejected, LAN IP literals are accepted.
    #[test]
    fn zero_bind_enforces_allowlist_no_wildcard() {
        let trusted = vec![vec!["myserver.local".to_string()]];
        assert!(is_valid_host("myserver.local", &trusted));
        assert!(!is_valid_host("attacker-controlled-rebind.com", &trusted));
        assert!(!is_valid_host("anything.evil", &trusted));
        assert!(!is_valid_host(
            &extract_host_from_origin("https://evil.com"),
            &trusted
        ));
        assert!(!is_valid_host(
            &extract_host_from_origin("http://malicious.example.org:8080"),
            &trusted
        ));
    }

    // LAN reachability preserved: private/loopback IP literals are accepted even
    // with an empty allowlist, so a 0.0.0.0 bind still serves LAN clients.
    #[test]
    fn private_and_loopback_ip_literals_accepted() {
        let trusted: Vec<Vec<String>> = vec![vec![]];
        assert!(is_valid_host("192.168.1.20:1337", &trusted));
        assert!(is_valid_host("10.0.0.5", &trusted));
        assert!(is_valid_host("172.16.4.4:8080", &trusted));
        assert!(is_valid_host("169.254.1.1", &trusted)); // link-local
        assert!(is_valid_host("[::1]:1337", &trusted)); // IPv6 loopback
        // A public IP literal is NOT auto-trusted.
        assert!(!is_valid_host("8.8.8.8:1337", &trusted));
    }

    fn none() -> Vec<Vec<String>> {
        vec![vec![]]
    }

    #[test]
    fn origin_loopback_and_app_origins_trusted() {
        let t = none();
        for o in [
            "http://localhost:3000",
            "https://localhost",
            "http://127.0.0.1:1337",
            "http://[::1]:8080",
            "HTTP://LOCALHOST:5173",
            "tauri://localhost",
        ] {
            assert!(is_trusted_origin(o, "127.0.0.1:1337", &t), "{o}");
        }
    }

    #[test]
    fn origin_foreign_sites_untrusted() {
        let t = none();
        for o in [
            "https://evil.com",
            "http://localhost.evil.com",
            "http://127.0.0.1.evil.com",
            "http://evil.com/localhost",
            "http://user@localhost",
            "null",
            "file://",
            "tauri://evil",
            "ftp://localhost",
            "chrome-extension://abcdef",
            "",
            "http://localhost:evil",
            "http://localhost:",
            "http://localhost:0",
            "http://localhost:65536",
            "http://localhost:+80",
            "http://localhost:80:80",
            "http://[::1]:evil",
            "http://[::1]x",
            "http://[::1",
            "http://:1337",
        ] {
            assert!(!is_trusted_origin(o, "127.0.0.1:1337", &t), "{o}");
        }
    }

    #[test]
    fn origin_port_must_be_a_valid_number() {
        let t = none();
        assert!(is_trusted_origin("http://localhost:65535", "127.0.0.1:1337", &t));
        assert!(is_trusted_origin("http://[::1]", "127.0.0.1:1337", &t));
        // The same-origin case cannot be met with a non-numeric port either.
        assert!(!is_same_or_app_origin("http://evil:x", "evil:x"));
        let listed = vec![vec!["myapp.local".to_string()]];
        assert!(!is_trusted_origin(
            "https://myapp.local:evil",
            "127.0.0.1:1337",
            &listed
        ));
    }

    // A page on another LAN machine must not get credentialed CORS just because
    // its address is private: the Host check accepts it, the origin check does not.
    #[test]
    fn origin_private_ip_untrusted_unless_listed() {
        let t = none();
        assert!(is_valid_host("192.168.1.20:3000", &t));
        assert!(!is_trusted_origin("http://192.168.1.20:3000", "127.0.0.1:1337", &t));
        assert!(!is_trusted_origin("http://10.0.0.5", "127.0.0.1:1337", &t));

        let listed = vec![vec!["192.168.1.20".to_string()]];
        assert!(is_trusted_origin("http://192.168.1.20:3000", "127.0.0.1:1337", &listed));
        assert!(!is_trusted_origin("http://192.168.1.21:3000", "127.0.0.1:1337", &listed));
    }

    #[test]
    fn origin_same_as_host_trusted() {
        let t = none();
        // API docs page opened over the LAN.
        assert!(is_trusted_origin("http://192.168.1.10:1337", "192.168.1.10:1337", &t));
        // Same IP, different port: a different site.
        assert!(!is_trusted_origin("http://192.168.1.10:8080", "192.168.1.10:1337", &t));
    }

    #[test]
    fn same_or_app_origin_only() {
        assert!(is_same_or_app_origin("tauri://localhost", ""));
        assert!(is_same_or_app_origin_on("http://tauri.localhost", "", true));
        assert!(is_same_or_app_origin_on("https://tauri.localhost", "", true));
        assert!(!is_same_or_app_origin_on("http://tauri.localhost", "", false));
        assert!(!is_same_or_app_origin_on("https://tauri.localhost", "", false));
        assert!(!is_same_or_app_origin_on("tauri://tauri.localhost", "", true));
        assert_eq!(
            is_same_or_app_origin("http://tauri.localhost", ""),
            cfg!(any(windows, target_os = "android"))
        );
        assert_eq!(
            is_trusted_origin("http://tauri.localhost", "127.0.0.1:1337", &none()),
            cfg!(any(windows, target_os = "android"))
        );
        assert!(is_same_or_app_origin("http://127.0.0.1:1337", "127.0.0.1:1337"));
        assert!(!is_same_or_app_origin("http://localhost:3000", "127.0.0.1:1337"));
        assert!(!is_same_or_app_origin("http://127.0.0.1:1337", ""));
    }

    #[test]
    fn origin_listed_hosts_and_wildcard() {
        let listed = vec![vec!["myapp.local".to_string(), "abcdef".to_string()]];
        assert!(is_trusted_origin("https://myapp.local:8443", "127.0.0.1:1337", &listed));
        assert!(is_trusted_origin("chrome-extension://abcdef", "127.0.0.1:1337", &listed));
        assert!(!is_trusted_origin("https://other.local", "127.0.0.1:1337", &listed));

        let wildcard = vec![vec!["*".to_string()]];
        assert!(is_trusted_origin("https://evil.com", "127.0.0.1:1337", &wildcard));
    }

    #[test]
    fn scheme_qualified_entries() {
        let listed = vec![vec![
            "app://obsidian.md".to_string(),
            "http://myapp.local:3000".to_string(),
            "http://127.0.0.1:1337/v1".to_string(),
        ]];
        let h = "127.0.0.1:1337";
        assert!(is_trusted_origin("app://obsidian.md", h, &listed));
        assert!(is_trusted_origin("APP://Obsidian.MD:8080", h, &listed));
        assert!(!is_trusted_origin("https://obsidian.md", h, &listed));
        // A port in the entry must match.
        assert!(is_trusted_origin("http://myapp.local:3000", h, &listed));
        assert!(!is_trusted_origin("http://myapp.local:4000", h, &listed));
        assert!(!is_trusted_origin("http://myapp.local", h, &listed));
        assert!(!is_trusted_origin("https://myapp.local:3000", h, &listed));
        // The scheme name is not a host.
        assert!(!is_trusted_origin("http://app", h, &listed));
        assert!(!is_trusted_origin("app://app", h, &listed));
    }

    #[test]
    fn opaque_origins_need_an_explicit_entry() {
        let h = "127.0.0.1:1337";
        assert!(!is_trusted_origin("null", h, &none()));
        assert!(!is_trusted_origin("file://", h, &none()));

        let null_listed = vec![vec!["null".to_string()]];
        assert!(is_trusted_origin("null", h, &null_listed));
        assert!(is_trusted_origin("NULL", h, &null_listed));
        assert!(!is_trusted_origin("file://", h, &null_listed));

        let file_listed = vec![vec![" file:// ".to_string()]];
        assert!(is_trusted_origin("file://", h, &file_listed));
        assert!(is_trusted_origin("FILE://", h, &file_listed));
        assert!(!is_trusted_origin("null", h, &file_listed));
        // Only the bare opaque origin; a host after file:// is not one.
        assert!(!is_trusted_origin("file://evil.com", h, &file_listed));

        // A web origin is never matched by these entries.
        let both = vec![vec!["null".to_string(), "file://".to_string()]];
        assert!(!is_trusted_origin("http://null", h, &both));
        assert!(!is_trusted_origin("https://evil.com", h, &both));

        // `*` still trusts everything.
        let wildcard = vec![vec!["*".to_string()]];
        assert!(is_trusted_origin("null", h, &wildcard));
        assert!(is_trusted_origin("file://", h, &wildcard));
    }

    #[test]
    fn scheme_qualified_entries_do_not_widen_host_check() {
        let listed = vec![vec![
            "app://obsidian.md".to_string(),
            "http://myapp.local:3000".to_string(),
        ]];
        assert!(!is_valid_host("app", &listed));
        assert!(!is_valid_host("http", &listed));
        assert!(!is_valid_host("http:3000", &listed));
        assert!(!is_valid_host("obsidian.md", &listed));
        assert!(!is_valid_host("myapp.local:3000", &listed));
    }

    // `*` means "any web page may call the API" (see `is_trusted_origin`). It
    // must not also mean "any Host header": a DNS-rebinding page reaches the
    // server under its own hostname, and the Host check is what refuses it.
    #[test]
    fn wildcard_does_not_make_every_host_valid() {
        let wildcard = vec![vec!["*".to_string()]];
        assert!(!is_valid_host("evil-rebind.attacker.com", &wildcard));
        assert!(!is_valid_host("evil-rebind.attacker.com:1337", &wildcard));
        assert!(!is_valid_host("8.8.8.8", &wildcard));
        assert!(!is_valid_host("", &wildcard));
        // The server's own names still pass, as they do with an empty list.
        assert!(is_valid_host("127.0.0.1:1337", &wildcard));
        assert!(is_valid_host("localhost", &wildcard));
        assert!(is_valid_host("192.168.1.20:1337", &wildcard));
    }

    #[test]
    fn wildcard_still_honours_a_hostname_listed_next_to_it() {
        let listed = vec![vec!["*".to_string(), "myserver.local".to_string()]];
        assert!(is_valid_host("myserver.local:1337", &listed));
        assert!(!is_valid_host("evil-rebind.attacker.com", &listed));
    }
}
