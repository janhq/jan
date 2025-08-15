use crate::commands::*;
use tauri::test::mock_app;

#[test]
fn test_system_info() {
    let app = mock_app();
    let info = get_system_info(app.handle().clone());
    println!("System Static Info: {:?}", info);
}

#[test]
fn test_system_usage() {
    let app = mock_app();
    let usage = get_system_usage(app.handle().clone());
    println!("System Usage Info: {:?}", usage);
}
