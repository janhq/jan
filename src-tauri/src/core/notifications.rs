//! Windows-only AppUserModelID registration for Toast notifications.
//!
//! Windows ToastNotificationManager silently drops notifications whose AUMID
//! is not registered in the system. In packaged NSIS builds the installer
//! creates a Start Menu shortcut that registers the AUMID; in `tauri dev`
//! no such shortcut exists, so we register a minimal HKCU entry ourselves.

#[cfg(target_os = "windows")]
pub fn ensure_aumid_registered(aumid: &str, display_name: &str) -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!("Software\\Classes\\AppUserModelId\\{aumid}");
    let (key, _) = hkcu.create_subkey(&path)?;
    key.set_value("DisplayName", &display_name.to_string())?;
    Ok(())
}
