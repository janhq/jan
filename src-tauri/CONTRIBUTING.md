# Contributing to Tauri Backend

[← Back to Main Contributing Guide](../CONTRIBUTING.md)

Rust backend that handles native system integration, file operations, and process management.

## Key Modules

- **`/src/core/app`** - App state and commands
- **`/src/core/downloads`** - Model download management  
- **`/src/core/filesystem`** - File system operations
- **`/src/core/mcp`** - Model Context Protocol
- **`/src/core/server`** - Local API server
- **`/src/core/system`** - System information and utilities
- **`/src/core/threads`** - Conversation management
- **`/utils`** - Shared utility crate (CLI, crypto, HTTP, path utils). Used by plugins and the main backend.
- **`/plugins`** - Native Tauri plugins ([see plugins guide](./plugins/CONTRIBUTING.md))

## Development

### Adding Tauri Commands

```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Processed: {}", param))
}

// Register in lib.rs
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![my_command])
```

## Building & Testing

```bash
# Development
yarn tauri dev

# Build 
yarn tauri build

# Run tests
cargo test
```

### Snapshot tests (agent TUI)

A few TUI surfaces (permission prompt, diff preview, header badges, todo and
subagent panels, `/agents`, model picker) are pinned by
[insta](https://insta.rs) snapshots in
`src/core/cli/tui/tests/snapshot.rs`, with baselines in `tui/tests/snapshots/`.
Each `.snap` holds the rendered text and the colour/modifier runs per row. The
module doc says when to add a snapshot rather than a substring test.

```bash
# Run them (they are part of the normal cli test run)
cargo test --locked --no-default-features --features cli --lib -- core::cli::tui::tests::snapshot

# A mismatch fails the test and writes a pending `<name>.snap.new` beside the
# baseline. Review and accept or reject each one interactively:
cargo install cargo-insta   # once
cargo insta review

# Or accept everything the run produces, without the review tool:
INSTA_UPDATE=always cargo test --locked --no-default-features --features cli --lib -- core::cli::tui::tests::snapshot
```

Commit the updated `.snap` files with the change that caused them, and never a
leftover `.snap.new`. With `CI=true` (set on GitHub Actions) and
`INSTA_UPDATE` unset, insta writes nothing and a mismatch only fails the test.

### State Management

```rust
#[tauri::command]
async fn get_data(state: State<'_, AppState>) -> Result<Data, Error> {
    state.get_data().await
}
```

### Error Handling

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

## Debugging

```rust
// Enable debug logging
env::set_var("RUST_LOG", "debug");

// Debug print in commands
#[tauri::command]
async fn my_command() -> Result<String, String> {
    println!("Command called"); // Shows in terminal
    dbg!("Debug info");
    Ok("result".to_string())
}
```

## Platform-Specific Notes

**Windows**: Requires Visual Studio Build Tools
**macOS**: Needs Xcode command line tools  
**Linux**: May need additional system packages

```rust
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
```

## Common Issues

**Build failures**: Check Rust toolchain version
**IPC errors**: Ensure command names match frontend calls
**Permission errors**: Update capabilities configuration

## Best Practices

- Always use `Result<T, E>` for fallible operations
- Validate all input from frontend
- Use async for I/O operations
- Follow Rust naming conventions
- Document public APIs

## Dependencies

- **Tauri** - Desktop app framework
- **Tokio** - Async runtime
- **Serde** - JSON serialization
- **thiserror** - Error handling