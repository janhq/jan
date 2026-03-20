fn main() {
    #[cfg(not(feature = "cli"))]
    {
        // Conditionally add foundation-models permissions to capability files
        #[cfg(feature = "foundation-models")]
        {
            use std::fs;
            use std::path::Path;

            let capabilities_dir = Path::new("capabilities");
            let files = ["default.json", "desktop.json"];

            for file in &files {
                let file_path = capabilities_dir.join(file);
                if let Ok(content) = fs::read_to_string(&file_path) {
                    if let Ok(mut json: serde_json::Value) = serde_json::from_str(&content) {
                        if let Some(permissions) = json.get_mut("permissions").and_then(|p| p.as_array_mut()) {
                            // Check if foundation-models permission already exists
                            let has_foundation_models = permissions.iter().any(|p| {
                                p.as_str().map_or(false, |s| s == "foundation-models:default")
                            });

                            if !has_foundation_models {
                                // Find the position after mlx:default
                                if let Some(mlx_idx) = permissions.iter().position(|p| {
                                    p.as_str().map_or(false, |s| s == "mlx:default")
                                }) {
                                    permissions.insert(mlx_idx + 1, serde_json::Value::String("foundation-models:default".to_string()));
                                    if let Ok(updated_content) = serde_json::to_string_pretty(&json) {
                                        let _ = fs::write(&file_path, updated_content);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        tauri_build::build();
    }

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        if let Ok(output) = std::process::Command::new("xcrun")
            .args(["--toolchain", "default", "--find", "swift"])
            .output()
        {
            let swift_path = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if let Some(toolchain) = std::path::Path::new(&swift_path)
                .parent()
                .and_then(|p| p.parent())
            {
                let lib_path = toolchain.join("lib/swift/macosx");
                if lib_path.exists() {
                    println!(
                        "cargo:rustc-link-arg=-Wl,-rpath,{}",
                        lib_path.display()
                    );
                }
            }
        }
    }
}
