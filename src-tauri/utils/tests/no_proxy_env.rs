//! Regression tests for https://github.com/janhq/jan/issues/8565
//!
//! `should_bypass_proxy` only consulted the app-supplied `no_proxy` list and
//! completely ignored the `NO_PROXY` / `no_proxy` environment variables. A
//! user behind a corporate proxy who lists an inner-network host in `NO_PROXY`
//! therefore still got that host routed through the proxy ("connection
//! failed"). These tests pin the env-var behavior.

use jan_utils::network::should_bypass_proxy;

// Rust runs tests in the same binary concurrently, and environment variables
// are process-global. Every test that touches NO_PROXY/no_proxy takes this
// lock so a concurrent test cannot observe another test's env value.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// RAII guard that clears both `NO_PROXY` and `no_proxy` (so a value set in
/// the developer's shell cannot leak into a test), optionally sets one of
/// them, and restores the original values when dropped.
struct EnvGuard {
    saved: Vec<(&'static str, Option<String>)>,
}

impl EnvGuard {
    fn clear() -> Self {
        let saved = ["NO_PROXY", "no_proxy"]
            .into_iter()
            .map(|k| (k, std::env::var(k).ok()))
            .collect();
        for k in ["NO_PROXY", "no_proxy"] {
            std::env::remove_var(k);
        }
        EnvGuard { saved }
    }

    fn set(key: &'static str, value: &str) -> Self {
        let guard = Self::clear();
        std::env::set_var(key, value);
        guard
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (k, v) in &self.saved {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
    }
}

/// Takes the env lock, ignoring poisoning from an earlier failed test.
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[test]
fn no_proxy_env_var_bypasses_matching_host() {
    let _lock = env_lock();
    let _guard = EnvGuard::set("NO_PROXY", "internal.corp.example");

    // Empty app-supplied list: without the env merge this must bypass anyway,
    // because the host is exempted via the environment.
    assert!(should_bypass_proxy(
        "http://internal.corp.example:8080/v1",
        &[]
    ));
}

#[test]
fn no_proxy_env_var_wildcard_bypasses_matching_host() {
    let _lock = env_lock();
    let _guard = EnvGuard::set("NO_PROXY", "*.corp.example");

    assert!(should_bypass_proxy(
        "https://api.corp.example/v1/chat/completions",
        &[]
    ));
    // A host outside the wildcard must still go through the proxy.
    assert!(!should_bypass_proxy("https://api.public.example/v1", &[]));
}

#[test]
fn lowercase_no_proxy_env_var_is_also_honored() {
    let _lock = env_lock();
    let _guard = EnvGuard::set("no_proxy", "localhost,127.0.0.1");

    assert!(should_bypass_proxy("http://localhost:3000", &[]));
    assert!(should_bypass_proxy("https://127.0.0.1:3928", &[]));
    // Hosts not listed are unaffected.
    assert!(!should_bypass_proxy("http://other.com/path", &[]));
}

#[test]
fn app_no_proxy_list_and_env_var_are_merged() {
    let _lock = env_lock();
    let _guard = EnvGuard::set("NO_PROXY", "internal.corp.example");
    let app_list = vec!["*.example.com".to_string()];

    // A host exempted only via the environment still bypasses the proxy.
    assert!(should_bypass_proxy(
        "http://internal.corp.example/v1",
        &app_list
    ));
    // A host exempted only via the app list still bypasses the proxy.
    assert!(should_bypass_proxy(
        "http://sub.example.com/path",
        &app_list
    ));
}

#[test]
fn ipv6_loopback_url_matches_bare_entry() {
    let _lock = env_lock();
    let _guard = EnvGuard::clear();
    let list = vec!["localhost".to_string(), "::1".to_string()];

    // `Url::host_str()` returns `[::1]`; the bare `::1` entry must still match.
    assert!(should_bypass_proxy("http://[::1]:3928/v1/models", &list));
    // Bracketed entries match too.
    assert!(should_bypass_proxy(
        "http://[::1]:3928/v1/models",
        &["[::1]".to_string()]
    ));
    // A different IPv6 host is not bypassed.
    assert!(!should_bypass_proxy("http://[2001:db8::1]:3928/", &list));
}

#[test]
fn ipv6_loopback_via_env_var_is_bypassed() {
    let _lock = env_lock();
    let _guard = EnvGuard::set("NO_PROXY", "localhost,127.0.0.1,::1");

    assert!(should_bypass_proxy("http://[::1]:3928/v1/models", &[]));
}

#[test]
fn wildcard_does_not_match_sibling_domain() {
    let _lock = env_lock();
    let _guard = EnvGuard::clear();
    let list = vec!["*.example.com".to_string()];

    assert!(!should_bypass_proxy("http://notexample.com/x", &list));
    assert!(!should_bypass_proxy("http://badexample.com/x", &list));
    // Subdomains and the bare domain still match.
    assert!(should_bypass_proxy("http://api.example.com/x", &list));
    assert!(should_bypass_proxy("http://a.b.example.com/x", &list));
    assert!(should_bypass_proxy("http://example.com/x", &list));
}
