const COMMANDS: &[&str] = &[
    "workspace_path",
    "thread_workspace_path",
    "thread_workspace_delete",
    "thread_workspace_sweep",
    "session_workspace_path",
    "session_workspace_delete",
    "session_workspace_sweep",
    "skill_list",
    "skill_read",
    "skill_write",
    "skill_delete",
    "skill_invoke",
    "memory_list",
    "memory_read",
    "memory_write",
    "memory_catalog",
    "memory_delete",
    "tool_schemas",
    "sandbox_status",
    "subagent_result_reserve",
    "subagent_result_fill",
    "blackboard_write",
    "attachment_import",
    "execute_thread_tool",
    "execute_tool",
    "execute_tool_streaming",
    "start_monitor",
    "stop_monitor",
    "list_monitors",
    "session_monitor_ids",
    "stop_session_monitors",
    "start_thread_monitor",
    "stop_thread_monitor",
    "list_thread_monitors",
    "stop_all_thread_monitors",
    "revoke_thread_capabilities",
    "cancel_thread_bash",
    "preview_register_root",
    "preview_unregister_root",
    "open_artifact",
];

fn main() {
    #[cfg(feature = "tauri")]
    tauri_plugin::Builder::new(COMMANDS).build();

    #[cfg(not(feature = "tauri"))]
    let _ = COMMANDS;
}
