# Unified Error Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified JSON Lines logging system that captures both frontend (React/TypeScript) and backend (Rust) errors into a single local log file for AI-driven debugging.

**Architecture:** Extend the existing `tauri-plugin-log` v2 with a custom JSON Formatter on the backend, and install `@tauri-apps/plugin-log` on the frontend to bridge console/global errors into the same file. Add global error interceptors (`window.onerror`, `unhandledrejection`, React Error Boundary) and a wrapped `invoke()` helper for Tauri command failures.

**Tech Stack:** React 19 + TypeScript (frontend), Rust + Tauri v2 (backend), `tauri-plugin-log` v2, `@tauri-apps/plugin-log` (frontend binding)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src-tauri/src/core/logger/mod.rs` | Logger module entry point — re-exports formatter and rotation |
| `src-tauri/src/core/logger/json_formatter.rs` | Custom `tauri_plugin_log::Format` implementation — outputs JSON Lines |
| `src-tauri/src/core/logger/rotation.rs` | Size-based log rotation (10MB cutoff, 5 backups) |
| `web-app/src/lib/logger.ts` | Frontend logging utilities — `logError()`, `logWarn()`, `logInfo()` with structured metadata |
| `web-app/src/lib/invoke-logger.ts` | Wrapped `invoke()` that automatically logs Tauri command failures |

### Modified Files
| File | Responsibility |
|------|---------------|
| `web-app/package.json` | Add `@tauri-apps/plugin-log` dependency |
| `web-app/src/main.tsx` | Initialize `attachConsole()` + register global error handlers before React mounts |
| `web-app/src/containers/GlobalError.tsx` | Add `logError()` call inside `componentDidCatch` |
| `src-tauri/src/core/mod.rs` | Add `pub mod logger;` |
| `src-tauri/src/lib.rs` | Replace `tauri-plugin-log` Builder config with `JsonFormatter` + call rotation before init |
| `src-tauri/src/core/modelscope/commands.rs` | Replace `println!` with `log::debug!` / `log::info!` |

---

## Prerequisites

- [ ] **Step 0.1: Confirm backend dependencies**

  Verify `chrono` is available in `src-tauri/Cargo.toml`:
  ```bash
  cd src-tauri && grep "^chrono" Cargo.toml
  ```
  Expected output: `chrono = { version = "0.4", features = ["serde"] }`

  Verify `tauri-plugin-log` is available:
  ```bash
  grep "tauri-plugin-log" Cargo.toml
  ```
  Expected output: `tauri-plugin-log = "2.0.0-rc"` (or similar v2)

---

## Task 1: Backend Logger Module

### Step 1.1: Create `src-tauri/src/core/logger/json_formatter.rs`

**File:** `src-tauri/src/core/logger/json_formatter.rs` (new)

```rust
use std::fmt;
use log::Record;
use tauri_plugin_log::Format;

pub struct JsonFormatter;

impl Format for JsonFormatter {
    fn format(&self, record: &Record, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let ts = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let level = record.level();
        let target = record.target();
        let raw_msg = record.args().to_string();

        // Parse the |META| delimiter sent from frontend logError()/logWarn()
        const META_DELIMITER: &str = " |META|";
        let (msg, meta) = if let Some(idx) = raw_msg.find(META_DELIMITER) {
            let (msg_part, meta_part) = raw_msg.split_at(idx);
            let meta_json = &meta_part[META_DELIMITER.len()..];
            (msg_part.trim(), Some(meta_json))
        } else {
            (raw_msg.as_str(), None)
        };

        let escaped_msg = escape_json(msg);

        if let Some(meta_json) = meta {
            writeln!(
                f,
                r#"{{"ts":"{ts}","level":"{level}","target":"{target}","msg":"{escaped_msg}","meta":{meta_json}}}"#
            )
        } else {
            writeln!(
                f,
                r#"{{"ts":"{ts}","level":"{level}","target":"{target}","msg":"{escaped_msg}","meta":null}}"#
            )
        }
    }
}

fn escape_json(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
```

### Step 1.2: Create `src-tauri/src/core/logger/rotation.rs`

**File:** `src-tauri/src/core/logger/rotation.rs` (new)

```rust
use std::fs;
use std::path::Path;

const MAX_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const MAX_BACKUPS: u32 = 5;

/// Rotate the log file if it exceeds MAX_SIZE_BYTES.
/// Renames existing backups and deletes the oldest if over MAX_BACKUPS.
pub fn rotate_if_needed(log_dir: &Path, file_name: &str) -> std::io::Result<()> {
    let current = log_dir.join(format!("{}.jsonl", file_name));
    if !current.exists() {
        return Ok(());
    }
    let metadata = fs::metadata(&current)?;
    if metadata.len() < MAX_SIZE_BYTES {
        return Ok(());
    }

    // Delete the oldest backup if it exists
    let oldest = log_dir.join(format!("{}.jsonl.{}", file_name, MAX_BACKUPS));
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }

    // Shift existing backups up by one
    for i in (1..MAX_BACKUPS).rev() {
        let src = log_dir.join(format!("{}.jsonl.{}", file_name, i));
        let dst = log_dir.join(format!("{}.jsonl.{}", file_name, i + 1));
        if src.exists() {
            fs::rename(src, dst)?;
        }
    }

    // Move current file to .1
    fs::rename(&current, log_dir.join(format!("{}.jsonl.1", file_name)))?;
    Ok(())
}
```

### Step 1.3: Create `src-tauri/src/core/logger/mod.rs`

**File:** `src-tauri/src/core/logger/mod.rs` (new)

```rust
pub mod json_formatter;
pub mod rotation;

pub use json_formatter::JsonFormatter;
pub use rotation::rotate_if_needed;
```

### Step 1.4: Register logger module in `src-tauri/src/core/mod.rs`

**File:** `src-tauri/src/core/mod.rs` (modify)

Find the existing `pub mod` declarations and add:

```rust
pub mod logger;
```

### Step 1.5: Modify `src-tauri/src/lib.rs` — replace tauri-plugin-log config

**File:** `src-tauri/src/lib.rs` (modify)

Find the existing `.setup()` block (around line 319–332) that initializes `tauri_plugin_log::Builder`.

Replace:
```rust
app.handle().plugin(
    tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Debug)
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                path: get_jan_data_folder_path(app.handle().clone()).join("logs"),
                file_name: Some("app".to_string()),
            }),
        ])
        .build(),
)?;
```

With:
```rust
// Rotate logs before the plugin opens the file handle
let log_dir = get_jan_data_folder_path(app.handle().clone()).join("logs");
crate::core::logger::rotate_if_needed(&log_dir, "app")?;

app.handle().plugin(
    tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Debug)
        .format(crate::core::logger::JsonFormatter)
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                path: log_dir,
                file_name: Some("app".to_string()),
            }),
        ])
        .build(),
)?;
```

### Step 1.6: Clean up `println!` in modelscope commands

**File:** `src-tauri/src/core/modelscope/commands.rs` (modify)

Find all `println!` calls and replace with `log::debug!` or `log::info!` as appropriate.

Example replacements:
```rust
// Before:
println!("[RUST:get_modelscope_model_files] called with model_id={}", model_id);
// After:
log::debug!("[RUST:get_modelscope_model_files] called with model_id={}", model_id);
```

Do this for every `println!` in the file.

### Step 1.7: Run Rust check

```bash
cd src-tauri && cargo check
```

Expected: **SUCCESS** (no errors, no warnings)

### Step 1.8: Commit backend changes

```bash
git add src-tauri/src/core/logger/ src-tauri/src/core/mod.rs src-tauri/src/lib.rs src-tauri/src/core/modelscope/commands.rs
git commit -m "feat(backend): add JSON Lines logger with rotation"
```

---

## Task 2: Frontend Logger Utilities

### Step 2.1: Install `@tauri-apps/plugin-log`

**File:** `web-app/package.json` (modify)

Add to `dependencies`:
```json
"@tauri-apps/plugin-log": "^2.0.0"
```

Then run:
```bash
cd web-app && yarn install
```

Expected: Package installs without errors.

### Step 2.2: Create `web-app/src/lib/logger.ts`

**File:** `web-app/src/lib/logger.ts` (new)

```typescript
import { error, warn, info } from '@tauri-apps/plugin-log'

const META_DELIMITER = ' |META|'

function serializeMeta(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta)
  } catch {
    // Fallback if meta contains circular references
    return JSON.stringify({ error: 'Failed to serialize meta' })
  }
}

/**
 * Log an error with optional structured metadata.
 * Metadata is embedded via |META| delimiter and parsed by the backend JsonFormatter.
 */
export function logError(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  error(payload)
}

/**
 * Log a warning with optional structured metadata.
 */
export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  warn(payload)
}

/**
 * Log an info message with optional structured metadata.
 */
export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  info(payload)
}
```

### Step 2.3: Create `web-app/src/lib/invoke-logger.ts`

**File:** `web-app/src/lib/invoke-logger.ts` (new)

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { logError } from './logger'

/**
 * Wrapper around Tauri's invoke() that automatically logs failed commands.
 * Use this for new code; existing code can continue using raw invoke()
 * since attachConsole() in main.tsx will catch console.error calls.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args)
  } catch (e) {
    logError(`invoke('${cmd}') failed: ${e}`, {
      command: cmd,
      args,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    throw e
  }
}
```

### Step 2.4: Modify `web-app/src/main.tsx` — initialize global error capture

**File:** `web-app/src/main.tsx` (modify)

Find the root render code (around `ReactDOM.createRoot` or `createRoot`).

Add imports at the top:
```typescript
import { attachConsole } from '@tauri-apps/plugin-log'
import { logError } from './lib/logger'
```

Before `createRoot(...).render(...)`, add an async init block:

```typescript
async function initLogging() {
  try {
    // Bridge frontend console.* to backend log file
    await attachConsole()

    // Global synchronous error handler
    window.onerror = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      logError(String(message), {
        url: window.location.href,
        stack: error?.stack,
        filename: source,
        line: lineno,
        col: colno,
      })
      return false
    }

    // Global unhandled promise rejection handler
    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      logError(`Unhandled promise rejection: ${reason}`, {
        url: window.location.href,
        reason: String(reason),
        stack: reason?.stack,
      })
    }
  } catch (e) {
    // Fallback: if plugin-log fails to initialize, at least log to console
    console.error('Failed to initialize logging:', e)
  }
}

await initLogging()
```

**Important:** Ensure `initLogging()` is called with `await` before React mounts. If the current `main.tsx` is synchronous, wrap the render in an async IIFE:

```typescript
;(async () => {
  await initLogging()
  createRoot(document.getElementById('root')!).render(<App />)
})()
```

### Step 2.5: Modify `web-app/src/containers/GlobalError.tsx` — log from Error Boundary

**File:** `web-app/src/containers/GlobalError.tsx` (modify)

Add import:
```typescript
import { logError } from '@/lib/logger'
```

In the `componentDidCatch` method, add before existing logic:
```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  logError(`React render error`, {
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    stack: error.stack,
    errorInfo: errorInfo.componentStack,
  })
  // ... existing logic ...
}
```

### Step 2.6: Run frontend type check

```bash
cd web-app && yarn tsc --noEmit
```

Expected: **SUCCESS** (no TS errors)

### Step 2.7: Commit frontend changes

```bash
git add web-app/package.json web-app/src/lib/logger.ts web-app/src/lib/invoke-logger.ts web-app/src/main.tsx web-app/src/containers/GlobalError.tsx
git commit -m "feat(frontend): add unified error logging with global capture"
```

---

## Task 3: Optional — Migrate Critical Path Console Errors

### Step 3.1: Update `web-app/src/hooks/useOpenClaw.ts`

**File:** `web-app/src/hooks/useOpenClaw.ts` (modify)

Replace key `console.error` calls with `logError`:

Find `import` section and add:
```typescript
import { logError } from '@/lib/logger'
```

Replace `console.error(...)` calls in catch blocks:
```typescript
// Before:
console.error('OpenClaw launch failed:', e)
// After:
logError('OpenClaw launch failed', { error: String(e), url: window.location.href })
```

Do similar replacements for other critical error paths in this hook.

### Step 3.2: Update `web-app/src/hooks/useOllamaStatus.ts`

**File:** `web-app/src/hooks/useOllamaStatus.ts` (modify)

Add import:
```typescript
import { logError } from '@/lib/logger'
```

Replace critical `console.error` calls similarly.

### Step 3.3: Commit optional migrations

```bash
git add web-app/src/hooks/useOpenClaw.ts web-app/src/hooks/useOllamaStatus.ts
git commit -m "refactor(frontend): migrate critical paths to logError()"
```

---

## Task 4: Verification

### Step 4.1: Full web build

```bash
cd web-app && yarn build:web
```

Expected: **SUCCESS**

### Step 4.2: Full Rust check

```bash
cd src-tauri && cargo check
```

Expected: **SUCCESS**

### Step 4.3: Run frontend tests (if they exist)

```bash
cd web-app && yarn test --run
```

Expected: All existing tests pass (no regressions).

### Step 4.4: Manual test — verify log file creation and format

Launch the app in dev mode:
```bash
yarn dev
```

Wait for app to fully load, then check the log file:
```powershell
$logPath = "$env:APPDATA\Jan\data\logs\app.jsonl"
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 5
} else {
    Write-Host "Log file not found at $logPath"
}
```

Expected: File exists, each line is valid JSON with fields `ts`, `level`, `target`, `msg`, `meta`.

### Step 4.5: Manual test — trigger frontend error

In the app's DevTools console, execute:
```javascript
throw new Error("manual test error")
```

Then check the log file again:
```powershell
Get-Content "$env:APPDATA\Jan\data\logs\app.jsonl" -Tail 3
```

Expected: A line with `"target":"frontend/global-error"`, `"msg":"manual test error"`, and `meta.stack` containing the stack trace.

### Step 4.6: Manual test — trigger unhandled rejection

In DevTools console:
```javascript
Promise.reject(new Error("manual rejection test"))
```

Check log file:
```powershell
Get-Content "$env:APPDATA\Jan\data\logs\app.jsonl" -Tail 3
```

Expected: A line with `"target":"frontend/unhandledrejection"`.

### Step 4.7: Manual test — verify backend JSON format

Check that Rust `log::info!` / `log::error!` outputs are also in JSON:
```powershell
Get-Content "$env:APPDATA\Jan\data\logs\app.jsonl" -Tail 10 | ForEach-Object { $_ | ConvertFrom-Json | Select-Object ts, level, target, msg }
```

Expected: All lines parse as JSON, backend entries have `meta: null`.

### Step 4.8: Commit verification results (optional)

If any manual test issues are found and fixed, commit those fixes.

---

## Self-Review Checklist

Run this after writing the plan:

- [ ] **Spec coverage**: Every requirement from the design doc has at least one implementing task.
- [ ] **Placeholder scan**: No "TBD", "TODO", "implement later", or vague descriptions.
- [ ] **Type consistency**: `logError` signature matches in `logger.ts`, `invoke-logger.ts`, `GlobalError.tsx`, `main.tsx`.
- [ ] **File paths**: All paths are exact and exist in the codebase.
- [ ] **Command correctness**: `cargo check`, `yarn tsc --noEmit`, `yarn build:web` are the correct commands for this project.

---

## Post-Implementation Notes

- `tauri-plugin-log` v2 `Format` trait signature may vary slightly between RC versions. If `cargo check` fails with a trait mismatch, check the exact `Format` definition in `tauri-plugin-log` source and adjust `json_formatter.rs` accordingly.
- If `chrono::SecondsFormat::Millis` is not available, use `chrono::SecondsFormat::Secs` or format manually.
- `attachConsole()` may not be available in `@tauri-apps/plugin-log` if the package version is too old. The plan assumes v2.x which supports it.
