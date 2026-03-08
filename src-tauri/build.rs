fn main() {
    #[cfg(not(feature = "cli"))]
    tauri_build::build()
}
