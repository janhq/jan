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