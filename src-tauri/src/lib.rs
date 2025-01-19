mod handlers;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let sidecar_command = app.shell().sidecar("cortex-server").unwrap().args([
                "--start-server",
                "--port",
                "39291",
                "--config_file_path",
                app.app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .join(".janrc")
                    .to_str()
                    .unwrap(),
                "--data_folder_path",
                app.app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .to_str()
                    .unwrap(),
            ]);
            let (mut rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn sidecar");
            tauri::async_runtime::spawn(async move {
                // read events such as stdout
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line_bytes) = event {
                        let line = String::from_utf8_lossy(&line_bytes);
                        println!("Outputs: {:?}", line)
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
