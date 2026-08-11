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

/// RAII guard that removes the env var when dropped, keeping the test process
/// clean for any other test in the same binary.
struct EnvGuard(&'static str);

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        std::env::set_var(key, value);
        EnvGuard(key)
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        std::env::remove_var(self.0);
    }
}

#[test]
fn no_proxy_env_var_bypasses_matching_host() {
    let _lock = ENV_LOCK.lock().unwrap();
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
    let _lock = ENV_LOCK.lock().unwrap();
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
    let _lock = ENV_LOCK.lock().unwrap();
    let _guard = EnvGuard::set("no_proxy", "localhost,127.0.0.1");

    assert!(should_bypass_proxy("http://localhost:3000", &[]));
    assert!(should_bypass_proxy("https://127.0.0.1:3928", &[]));
    // Hosts not listed are unaffected.
    assert!(!should_bypass_proxy("http://other.com/path", &[]));
}

#[test]
fn app_no_proxy_list_and_env_var_are_merged() {
    let _lock = ENV_LOCK.lock().unwrap();
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
