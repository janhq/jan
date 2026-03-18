const COMMANDS: &[&str] = &[
    "agent_run",
    "agent_reset",
    "get_tool_manifest",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
