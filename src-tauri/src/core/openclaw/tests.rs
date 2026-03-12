use super::commands::needs_upgrade;

#[test]
fn test_needs_upgrade_older_version() {
    assert!(needs_upgrade("2026.3.1", "2026.3.2"));
    assert!(needs_upgrade("2026.2.26", "2026.3.2"));
    assert!(needs_upgrade("2025.1.0", "2026.3.2"));
}

#[test]
fn test_needs_upgrade_same_version() {
    assert!(!needs_upgrade("2026.3.2", "2026.3.2"));
}

#[test]
fn test_needs_upgrade_newer_version() {
    assert!(!needs_upgrade("2026.4.0", "2026.3.2"));
    assert!(!needs_upgrade("2026.3.3", "2026.3.2"));
    assert!(!needs_upgrade("2027.0.0", "2026.3.2"));
}

#[test]
fn test_needs_upgrade_unparseable() {
    assert!(!needs_upgrade("custom-build", "2026.3.2"));
    assert!(!needs_upgrade("", "2026.3.2"));
    assert!(!needs_upgrade("2026.3.2", "custom"));
    assert!(!needs_upgrade("abc", "def"));
}
