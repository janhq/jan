# Contributing to Tauri Plugins

[← Back to Main Contributing Guide](../../CONTRIBUTING.md) | [← Back to Tauri Guide](../CONTRIBUTING.md)

Native Rust plugins for hardware access, process management, and system integration.

## Current Plugins

### `/tauri-plugin-hardware`
- Hardware detection (CPU, GPU, memory)

### `/tauri-plugin-llamacpp`  
- llama.cpp process management and model inference

## Plugin Structure

```
tauri-plugin-name/
├── Cargo.toml
├── src/lib.rs          # Plugin entry point
├── src/commands.rs     # Tauri commands
├── guest-js/index.ts   # JavaScript API
└── permissions/default.toml
```

## Development

### Creating Plugins

Assuming that your new plugin name is `my-plugin`

```bash
# with npx
npx @tauri-apps/cli plugin new my-plugin

# with cargo
cargo tauri plugin new my-plugin

cd tauri-plugin-my-plugin
```

### Plugin Registration

```rust
use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("my-plugin")
        .invoke_handler(tauri::generate_handler![commands::my_command])
        .build()
}
```

### Commands & JavaScript API

```rust
#[tauri::command]
pub async fn my_command(param: String) -> Result<String, Error> {
    Ok(format!("Result: {}", param))
}
```

```typescript
import { invoke } from '@tauri-apps/api/core'

export async function myCommand(param: string): Promise<string> {
  return await invoke('plugin:my-plugin|my_command', { param })
}
```

### Building & Testing

```bash
cargo build    # Build plugin
yarn build     # Build JavaScript
cargo test     # Run tests
```

## Security Considerations

```toml
# permissions/default.toml - Be specific
[[permission]]
identifier = "allow-hardware-info"
description = "Read system hardware information"

# Never use wildcards in production
# ❌ identifier = "allow-*"
# ✅ identifier = "allow-specific-action"
```

## Testing Plugins

```bash
# Test plugin in isolation
cd tauri-plugin-my-plugin
cargo test

# Test with main app
cd ../../
yarn tauri dev

# Test JavaScript API
yarn build && node -e "const plugin = require('./dist-js'); console.log(plugin)"
```

## Best Practices

- Use secure permission configurations
- Validate all command inputs
- Handle platform differences properly
- Clean up resources in Drop implementations
- Test on all target platforms

## Dependencies

- **Tauri** - Plugin framework
- **Serde** - JSON serialization
- **Tokio** - Async runtime (if needed)