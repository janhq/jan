const COMMANDS: &[&str] = &[
    "workspace_path",
    "thread_workspace_path",
    "thread_workspace_delete",
    "thread_workspace_sweep",
    "skill_list",
    "skill_read",
    "skill_write",
    "skill_delete",
    "memory_list",
    "memory_read",
    "memory_write",
    "memory_delete",
    "tool_schemas",
    "sandbox_status",
    "execute_tool",
];

fn main() {
    #[cfg(feature = "tauri")]
    tauri_plugin::Builder::new(COMMANDS).build();

    #[cfg(not(feature = "tauri"))]
    let _ = COMMANDS;
}
