use jan_utils::is_valid_origin;

// Issue #8608: a custom Electron scheme origin (e.g. app://obsidian.md) must
// be accepted when the user lists the scheme-qualified origin in Trusted
// Hosts.
#[test]
fn custom_scheme_origin_in_trusted_hosts_is_accepted() {
    let trusted = vec![vec!["app://obsidian.md".to_string()]];
    assert!(is_valid_origin("app://obsidian.md", &trusted));
    // A port-bearing origin for the same scheme and host must also match.
    assert!(is_valid_origin("app://obsidian.md:1337", &trusted));
    // Untrusted custom-scheme origins are still rejected.
    assert!(!is_valid_origin("app://evil.com", &trusted));
}

// Trusting a custom scheme must not also trust the same host over another
// scheme, in particular the web origin https://obsidian.md.
#[test]
fn scheme_qualified_entry_does_not_trust_other_schemes() {
    let trusted = vec![vec!["app://obsidian.md".to_string()]];
    assert!(!is_valid_origin("https://obsidian.md", &trusted));
    assert!(!is_valid_origin("http://obsidian.md", &trusted));
    assert!(!is_valid_origin("chrome-extension://obsidian.md", &trusted));
}

// Bare-host entries keep matching any scheme, as before.
#[test]
fn bare_host_entry_matches_any_scheme() {
    let trusted = vec![vec!["obsidian.md".to_string()]];
    assert!(is_valid_origin("https://obsidian.md", &trusted));
    assert!(is_valid_origin("app://obsidian.md", &trusted));
    assert!(!is_valid_origin("https://evil.com", &trusted));
}
