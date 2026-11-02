//! Test-build-only browser isolation, applied before Tauri creates any window.
//! WKWebView ignores data_directory on macOS. Incognito maps to WebKit's
//! nonPersistentDataStore (wry 0.55.1), not the account's default website store.

pub(crate) fn configure<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
    for window in &mut context.config_mut().app.windows {
        window.incognito = true;
        window.data_directory = None;
        window.data_store_identifier = None;
    }
    // Runtime-created frontend windows do not inherit WindowConfig. Fail closed
    // rather than let their callers omit incognito. Native screenshot windows
    // opt in separately through tauri-plugin-agent-tools/e2e.
    context
        .runtime_authority_mut()
        .add_capability(
            tauri::ipc::CapabilityBuilder::new("e2e-no-browser-creation")
                .window("*")
                .webview("*")
                .permission("core:webview:deny-create-webview")
                .permission("core:webview:deny-create-webview-window"),
        )
        .expect("e2e must deny unisolated frontend webviews");
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_initial_webview_is_ephemeral() {
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert!(!context.config().app.windows.is_empty());
        let create = "plugin:webview|create_webview_window";
        // Prove the shipped allow exists before checking deny precedence.
        assert!(context
            .runtime_authority_mut()
            .resolve_access(create, "main", "main", &tauri::ipc::Origin::Local,)
            .is_some());
        super::configure(&mut context);
        for command in [create, "plugin:webview|create_webview"] {
            for label in ["main", "logs-app-window", "other"] {
                assert!(
                    context
                        .runtime_authority_mut()
                        .resolve_access(command, label, label, &tauri::ipc::Origin::Local,)
                        .is_none(),
                    "{command} must be denied for {label}"
                );
            }
        }
        for window in &context.config().app.windows {
            assert!(window.incognito);
            assert!(window.data_directory.is_none());
            assert!(window.data_store_identifier.is_none());
        }
    }
}
