# Jan Agent CLI TUI — Development Guide

## Overview

The **Jan Agent CLI TUI** is a terminal-based interactive UI for Jan's agent. It uses [ratatui](https://ratatui.rs) (a Rust TUI framework) and [crossterm](https://github.com/crossterm-rs/crossterm) for terminal control.

The CLI binary (`jan`) is separate from the desktop binary (`jan-desktop`). They share the same library crate (`app_lib`).

### Architecture

```
jan (binary, src-tauri/src/bin/jan.rs)
  └── app_lib (library, src-tauri/src/core/)
        └── cli/
              ├── mod.rs       — CLI entry points, thread management
              ├── tui.rs       — Main TUI: App, event loop, rendering
              ├── mcp.rs       — MCP server management
              ├── providers.rs — Provider config overrides
              ├── path_refs.rs — File path resolution
              └── preset.rs    — Model presets
```

### Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/bin/jan.rs` | CLI binary entry point (clap argument parsing) |
| `src-tauri/src/core/cli/mod.rs` | CLI public API + thread listing |
| `src-tauri/src/core/cli/tui.rs` | Main TUI (~4600+ lines): `App` struct, event loop, rendering, commands |
| `src-tauri/Cargo.toml` | Crate config; `cli` feature gates TUI dependencies |

## Build

### First Time Setup

```bash
# The project is at:
cd /Users/alandao/Documents/codes/jan-agent

# Rust toolchain (already installed):
rustc --version   # 1.77.2+ (minimum)
```

### Build Commands

```bash
# Quick check (no binary produced):
cd src-tauri && cargo check --no-default-features --features cli --lib

# Debug build + install to ~/.local/bin:
cd /Users/alandao/Documents/codes/jan-agent
./build-tui.sh            # debug
./build-tui.sh release    # release (optimized, slower build)

# Release build (optimized, smaller binary):
cd src-tauri && cargo build --no-default-features --features cli --bin jan --release
```

### Using the Build Script

The `build-tui.sh` script at the project root automates building and installing:

```bash
./build-tui.sh check    # cargo check (fast, no binary)
./build-tui.sh test     # run TUI unit tests only
./build-tui.sh debug    # debug build + install (default)
./build-tui.sh release  # release build + install
./build-tui.sh help     # show help
```

The script installs the binary to `~/.local/bin/jan-agent`. Make sure `~/.local/bin` is in your `PATH`.

### Binary vs Library

- The **library** (`app_lib`) is what you build in CI/CD for both desktop and CLI,
  but the two are mutually exclusive feature configs: `cli` compiles out every
  Tauri-dependent module, and the Tauri/GTK crates are not even dependencies.
- The **CLI binary** (`jan`) needs `--no-default-features --features cli` to include TUI dependencies.
- The **desktop binary** (`jan-desktop`) uses the `desktop` feature (Tauri).

When developing TUI features, use `cargo check --no-default-features --features cli --lib` for the fast inner loop (checks only the library, not binary linking).

## Testing

### Run All TUI Tests

```bash
cd src-tauri && cargo test --no-default-features --features cli --lib -- core::cli::tui
```

### Run a Specific Test

```bash
cd src-tauri && cargo test --no-default-features --features cli --lib -- core::cli::tui::tests::submit_user_attaches_pending_images_and_renders_label
```

### Watch Mode (auto-re-run on changes)

```bash
cd src-tauri && cargo watch -x "test --no-default-features --features cli --lib -- core::cli::tui"
```

*(Requires `cargo watch`: `cargo install cargo-watch`)*

### Test Coverage

There are 100+ tests covering:
- Message rendering (user, assistant, tool calls)
- Tool folding and expansion
- Subagent panels
- Reasoning blocks
- Slash commands (/help, /new, /clear, /goal, etc.)
- Permission prompts
- Clipboard image attachment
- Thread display and sorting
- Scroll and viewport behavior

## Key TUI Components

### App Struct (`src-tauri/src/core/cli/tui.rs`)

The `App` struct holds all mutable TUI state. Key fields:

```
status: Status              — Idle / Running / PendingPermission
input: String               — current text in the input box
cursor: usize               — cursor position in input
transcript: Vec<Line>       — rendered chat lines
history: Vec<Value>         — JSON message history (persisted)
message_queue: VecDeque     — messages queued while running
pending_queue: Vec<Value>   — pending permission prompts
```

### Event Loop (`chat_loop` function)

```
1. Draw frame (render)
2. Poll event (80ms tick when Running, blocking read when Idle)
3. Handle keyboard/mouse event
4. Process any StreamEvents from agent channel
5. If want_start, spawn agent run with queued images
6. Loop
```

### Stream Processing (`apply` method)

The `apply` method processes `StreamEvent`s from the agent:

| Event | Behavior |
|-------|----------|
| `Start` | Records run start time |
| `Text` | Appends to assistant buffer, updates transcript |
| `Thinking` | Shows throbber row |
| `Reasoning` | Appends to reasoning block |
| `ToolCall` | Opens a tool group row |
| `ToolResult` | Closes tool group, shows result |
| `End` / `Error` | Sets status to Idle, commits transcript, calls `dequeue_next()` |

### Render Pipeline (`render` method)

```
header    — jan agent badge, model name, git branch, tokens, elapsed time, goal status
transcript — scrollable chat area with user/assistant/tool rows
input_box  — text input area
path_line — project root path + git branch (dimmed, between input and footer)
footer     — keybinding hints
```

### Input Handling (`handle_key` function)

The TUI supports non-blocking input — the user can type even while the agent is running:

| Key | Action |
|-----|--------|
| Enter | Submit / queue message |
| Alt+Enter / Ctrl+J | Insert newline |
| Backspace / Delete | Edit input |
| Left / Right / Home / End | Cursor movement |
| Up / Down | Scroll transcript |
| PageUp / PageDown | Scroll by page |
| Ctrl-O | Toggle expand/collapse all regions |
| Ctrl-V | Attach clipboard image |
| Ctrl-C / Esc | Cancel current run |
| Ctrl-D | Quit TUI |
| Ctrl-Z | Suspend (SIGTSTP) |
| Tab | Autocomplete / cycle slash commands |

### Message Queue System

The message queue allows typing and submitting messages while the agent is running:

1. **Enqueue**: `submit_user()` checks `self.status == Status::Running`. If running, it pushes to `self.message_queue` instead of starting a new agent turn. A note "⏳ message queued (N in queue)" is shown.

2. **Auto-dequeue**: `dequeue_next()` is called automatically from:
   - `on_done()` — agent turn completed successfully
   - `on_error()` — agent turn errored
   - `cancel_run()` — user cancelled the current turn
   - Stream close (channel closed without End/Error)

3. **Queue UI**:
   - Footer shows "⏳ Queued (N)" badge when messages are waiting
   - Input box shows queue count during running
   - Placeholder text changes to "Type to queue next message"

4. **Management**:
   - `/cancel` — clear all queued messages
   - `/cancel N` — remove the Nth queued message (1-indexed)
   - Queue is cleared on `/new`, `/clear`, and thread resume

### Slash Commands

Defined in the `SLASH_COMMANDS` const array and handled by `run_command()`:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Start a new session |
| `/clear` | Clear the conversation |
| `/compact` | Summarize older turns |
| `/goal [condition\|clear]` | Set/list/clear a goal |
| `/threads` | List saved threads |
| `/resume [id]` | Resume a thread |
| `/model [id]` | Switch model |
| `/mcp` | Manage MCP servers |
| `/cancel [N]` | Cancel queued messages |
| `/config` | View provider config |
| `/quit` | Exit the TUI |

### Tab Completion

The TUI supports Tab-based slash command completion:
- Tab cycles through matching slash commands
- Shift+Tab cycles backwards
- If input doesn't start with `/`, Tab inserts 2 spaces

## Running the TUI

```bash
# After building (binary at ~/.local/bin/jan-agent):
jan-agent tui

# Or from the project:
cd src-tauri && cargo run --no-default-features --features cli --bin jan -- tui

# With a specific model:
jan-agent tui --model my-model

# With provider overrides:
jan-agent tui --provider openai --model gpt-4
```

## Making Changes

### Typical Workflow

```bash
# 1. Edit the TUI code
vim src-tauri/src/core/cli/tui.rs

# 2. Quick check (30s)
./build-tui.sh check

# 3. Run tests (30s)
./build-tui.sh test

# 4. Build and install (60s)
./build-tui.sh debug

# 5. Test in terminal
jan-agent tui
```

### Adding a New Slash Command

1. Add a `SlashCommand` entry to the `SLASH_COMMANDS` const array
2. Add a `match` arm in `run_command()` function
3. If complex logic, extract to a helper function (e.g., `cancel_command()`)

### Adding New TUI Tests

Tests are in the `#[cfg(test)] mod tests` block at the bottom of `tui.rs`:

```rust
#[test]
fn my_new_test() {
    let mut app = test_app();     // helper that creates an App with test config
    app.submit_user("hello".into());
    // ... assert on app.transcript, app.history, etc.
}
```

### Key Patterns for Tests

- `test_app()` — creates an `App` instance with a temp directory, ready for testing
- `push_agent_event(app, ...)` — simulates a stream event from the agent
- Inspect `app.transcript` for rendered line content
- Inspect `app.history` for JSON message history
- Use `app.note_count()` or `app.detail` for status messages

## Troubleshooting

### "Not in PATH" after install

```bash
# Add to your shell config (~/.zshrc, ~/.bashrc):
export PATH="$HOME/.local/bin:$PATH"
```

### "features `cli` and `tauri-app`/`desktop` are mutually exclusive"

`--features cli` on its own still enables the crate's `default` features (which
include `desktop`). The CLI is a Tauri-free build, so it must opt out of them:

```bash
cd src-tauri && cargo check --no-default-features --features cli --lib
```

### "signal: 9" (SIGKILL) during build

The Rust compiler may run out of memory on large builds. Try:

```bash
# Limit parallel codegen units
cd src-tauri && CARGO_BUILD_JOBS=2 cargo build --no-default-features --features cli --bin jan
```

### TUI rendering artifacts

If the terminal shows garbage after quitting:
```bash
reset   # Resets the terminal completely
```
Or press Ctrl-Z (suspend) then `fg` to restore.
