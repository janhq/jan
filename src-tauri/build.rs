fn main() {
    #[cfg(feature = "tauri-app")]
    {
        tauri_build::build();
    }

    // Windows: resolve the executable's own static imports from System32 only
    // (LOAD_LIBRARY_SEARCH_SYSTEM32), so a DLL dropped in the install folder
    // cannot stand in for a system DLL of the same name. Every static import of
    // Jan-Desktop.exe is a system DLL, so nothing is loaded from the app folder
    // this way. The flag applies to the binaries only; test executables and
    // other targets keep the default search.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        if let Ok(output) = std::process::Command::new("xcrun")
            .args(["--toolchain", "default", "--find", "swift"])
            .output()
        {
            let swift_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(toolchain) = std::path::Path::new(&swift_path)
                .parent()
                .and_then(|p| p.parent())
            {
                let lib_path = toolchain.join("lib/swift/macosx");
                if lib_path.exists() {
                    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_path.display());
                }
            }
        }
    }
}
