use jan_utils::{extract_host_from_origin, is_valid_host};

// Issue #8608: a custom Electron scheme origin (e.g. app://obsidian.md) must
// be accepted when the user lists the scheme-qualified origin in Trusted
// Hosts. The CORS preflight path extracts "obsidian.md" from the origin and
// compares it against the user's "app://obsidian.md" entry, so the trusted
// value must be normalized by stripping its scheme.
#[test]
fn custom_scheme_origin_in_trusted_hosts_is_accepted() {
    let trusted = vec![vec!["app://obsidian.md".to_string()]];
    let origin_host = extract_host_from_origin("app://obsidian.md");
    assert_eq!(origin_host, "obsidian.md");
    assert!(is_valid_host(&origin_host, &trusted));
    // A port-bearing host for the same origin must also match.
    assert!(is_valid_host("obsidian.md:1337", &trusted));
    // Untrusted custom-scheme origins are still rejected.
    assert!(!is_valid_host("evil.com", &trusted));
}
