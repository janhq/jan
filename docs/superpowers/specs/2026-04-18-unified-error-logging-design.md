# Unified Error Logging Design

> 设计日期：2026-04-18
> 状态：待实现
> 关联需求：开发阶段手动测试排错，AI 可读取本地日志分析前后端错误

---

## 1. 背景与现状

### 1.1 后端日志现状
- 已使用 `tauri-plugin-log` v2，配置写入 `<jan_data>/logs/app.log`
- 日志级别 `Debug`，目标：stdout + webview + Folder
- Rust 代码广泛使用 `log::error!` / `warn!` / `info!` / `debug!` 宏（约 100+ 处）
- Tauri 命令统一返回 `Result<T, String>`，错误以字符串形式传回前端
- 部分生产代码残留 `println!`（`modelscope/commands.rs` 等）

### 1.2 前端日志现状
- 322 处 `console.error/log/warn` 分散在 99 个文件中
- 320 个 `catch` 块分散在 96 个文件中
- 没有全局错误捕获机制（无 `window.onerror`、`unhandledrejection` 注册）
- 没有使用 `@tauri-apps/plugin-log` 前端绑定
- React 路由有错误边界 `containers/GlobalError.tsx`，但不记录日志
- 前端错误**完全不落盘**，手动测试出错时无法追溯

### 1.3 核心缺口
前端报错（JS 异常、React 渲染错误、未处理 Promise、Tauri 命令失败）无法被持久化到本地日志文件，导致 AI / 开发者排错时只能看到后端的 Rust 日志，看不到前端的错误上下文。

---

## 2. 目标

1. **统一格式**：前后端日志统一输出为 JSON Lines 格式，写入同一个文件
2. **前端采集**：自动捕获前端所有异常（`onerror`、`unhandledrejection`、Error Boundary、Tauri 失败）
3. **结构化元数据**：前端错误附带 URL、组件名、stack trace、命令参数等上下文
4. **开发排错**：纯开发工具，无用户可见 UI，AI 可直接读取日志文件分析
5. **最小侵入**：不强制修改现有 322 处 `console.error`，通过全局拦截 + 新工具函数渐进迁移

---

## 3. 架构设计

采用 **方案 1：tauri-plugin-log 原生增强**，理由：
- 复用已有 `tauri-plugin-log` 插件，改动最小
- 利用官方前端绑定 `@tauri-apps/plugin-log`，IPC 性能最优
- 单一日志文件便于 AI 读取分析

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (React/TS)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ window.onerror│  │ unhandledrejection│  │ Error Boundary │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         └─────────────────┴─────────────────┘                       │
│                           │                                         │
│                    ┌──────▼──────┐                                  │
│                    │  logError()  │  ← 新工具函数                     │
│                    │  (lib/logger.ts)│                                │
│                    └──────┬──────┘                                  │
│                           │                                         │
│              ┌────────────┼────────────┐                           │
│              ▼            ▼            ▼                           │
│     ┌────────────┐ ┌──────────┐ ┌────────────┐                    │
│     │@tauri-apps/│ │ console  │ │ invoke()   │                    │
│     │plugin-log  │ │ (fallback)│ │ wrapper    │                    │
│     └─────┬──────┘ └────┬─────┘ └─────┬──────┘                    │
│           └─────────────┴─────────────┘                             │
│                         │                                           │
└─────────────────────────┼───────────────────────────────────────────┘
                          │ IPC
┌─────────────────────────┼───────────────────────────────────────────┐
│                      Backend (Rust)                                  │
│                         │                                           │
│              ┌──────────▼──────────┐                                │
│              │  tauri-plugin-log   │                                │
│              │  (JsonFormatter)    │                                │
│              └──────────┬──────────┘                                │
│                         │                                           │
│              ┌──────────▼──────────┐                                │
│              │  <data>/logs/app.jsonl │                             │
│              │  (JSON Lines)          │                             │
│              └───────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 日志文件
- **路径**：`<jan_data>/logs/app.jsonl`
- **格式**：JSON Lines（每行一个完整 JSON 对象）
- **轮转**：按大小轮转，10MB 切分，保留 5 个历史文件
- **旧文件**：原 `app.log` 自动废弃，新日志写入 `app.jsonl`

---

## 4. JSON 格式 Schema

### 4.1 统一结构

```json
{
  "ts": "2026-04-18T18:13:19.931+08:00",
  "level": "ERROR",
  "target": "frontend/hub",
  "msg": "Failed to load running models",
  "meta": {
    "url": "http://localhost:1420/hub",
    "stack": "Error: Network Error\n    at fetchRunningModels (index.tsx:142)\n    ...",
    "component": "HubPage"
  }
}
```

### 4.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ts` | string | 是 | ISO 8601 格式，带时区偏移，毫秒精度 |
| `level` | string | 是 | `TRACE` / `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `target` | string | 是 | 后端为 Rust 模块路径（如 `src-tauri/src/core/ollama_control_plane/commands.rs:45`）；前端为 `frontend` 或 `frontend/<subsystem>` |
| `msg` | string | 是 | 日志消息正文，已转义 |
| `meta` | object \| null | 否 | 结构化上下文数据，不同来源字段不同 |

### 4.3 不同来源的 `meta` 示例

**后端 Rust 日志**（`meta` 为 `null`）：
```json
{"ts":"2026-04-18T18:13:19.931+08:00","level":"ERROR","target":"src-tauri/src/core/ollama_control_plane/commands.rs:45","msg":"Ollama run failed: HTTP 500","meta":null}
```

**前端全局错误**（`window.onerror`）：
```json
{"ts":"2026-04-18T18:13:19.931+08:00","level":"ERROR","target":"frontend/global-error","msg":"Uncaught TypeError: Cannot read properties of undefined","meta":{"url":"http://localhost:1420/hub","stack":"TypeError: Cannot read properties of undefined\n    at HubPage (index.tsx:89)...","filename":"index.tsx","line":89,"col":12}}
```

**前端未处理 Promise**（`unhandledrejection`）：
```json
{"ts":"2026-04-18T18:13:19.931+08:00","level":"ERROR","target":"frontend/unhandledrejection","msg":"Unhandled promise rejection: Failed to fetch","meta":{"url":"http://localhost:1420/hub","reason":"Failed to fetch","stack":"Error: Failed to fetch\n    at fetchModels (default.ts:45)..."}}
```

**Tauri invoke 失败**（包装器捕获）：
```json
{"ts":"2026-04-18T18:13:19.931+08:00","level":"ERROR","target":"frontend/invoke","msg":"invoke('ollama_run_model') failed: Ollama run failed: HTTP 500","meta":{"command":"ollama_run_model","args":{"model":"qwen2.5:7b"},"url":"http://localhost:1420/hub"}}
```

**React Error Boundary**（`GlobalError.tsx`）：
```json
{"ts":"2026-04-18T18:13:19.931+08:00","level":"ERROR","target":"frontend/error-boundary","msg":"React render error in component HubPage","meta":{"url":"http://localhost:1420/hub","component":"HubPage","stack":"Error: Something went wrong\n    at HubPage.render (index.tsx:95)...","errorInfo":"The above error occurred in the <HubPage> component"}}
```

---

## 5. 前端实现

### 5.1 依赖

新增 `web-app/package.json` 依赖：
```json
"@tauri-apps/plugin-log": "^2.0.0"
```

### 5.2 日志工具模块（新建 `web-app/src/lib/logger.ts`）

```typescript
import { error, warn, info } from '@tauri-apps/plugin-log'

const META_DELIMITER = ' |META|'

/**
 * 记录前端错误日志，附带结构化元数据
 * 消息中嵌入 |META|JSON 分隔符，后端 Formatter 解析展开
 */
export function logError(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta ? `${msg}${META_DELIMITER}${JSON.stringify(meta)}` : msg
  error(payload)
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta ? `${msg}${META_DELIMITER}${JSON.stringify(meta)}` : msg
  warn(payload)
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta ? `${msg}${META_DELIMITER}${JSON.stringify(meta)}` : msg
  info(payload)
}
```

### 5.3 App 启动初始化（修改 `web-app/src/main.tsx`）

在应用挂载前初始化日志桥接和全局错误捕获：

```typescript
import { attachConsole } from '@tauri-apps/plugin-log'
import { logError } from './lib/logger'

async function initLogging() {
  // 将前端 console.* 桥接到后端日志系统
  await attachConsole()

  // 捕获未处理的同步异常
  window.onerror = (message, source, lineno, colno, error) => {
    logError(String(message), {
      url: window.location.href,
      stack: error?.stack,
      filename: source,
      line: lineno,
      col: colno,
    })
    return false
  }

  // 捕获未处理的 Promise rejection
  window.onunhandledrejection = (event) => {
    const reason = event.reason
    logError(`Unhandled promise rejection: ${reason}`, {
      url: window.location.href,
      reason: String(reason),
      stack: reason?.stack,
    })
  }
}

// 在 ReactDOM.createRoot 之前调用
await initLogging()
```

### 5.4 React Error Boundary（修改 `web-app/src/containers/GlobalError.tsx`）

在现有 `componentDidCatch` 中追加日志记录：

```typescript
import { logError } from '@/lib/logger'

componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  logError(`React render error`, {
    url: window.location.href,
    stack: error.stack,
    errorInfo: errorInfo.componentStack,
  })
  // 保留原有逻辑...
}
```

### 5.5 Tauri invoke 包装器（新建 `web-app/src/lib/invoke-logger.ts`）

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { logError } from './logger'

/**
 * 包装 Tauri invoke，自动记录失败的命令调用
 * 新代码推荐使用，旧代码保持不动（attachConsole 兜底）
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
      url: window.location.href,
    })
    throw e
  }
}
```

### 5.6 现有代码的渐进迁移策略

- **不强制**修改现有的 322 处 `console.error`——`attachConsole()` 会自动将其桥接到后端
- **推荐**新代码和关键路径（如 `useOpenClaw.ts`、`useOllamaStatus.ts`）逐步替换为 `logError()`
- **关键路径**（模型加载、Ollama 控制、OpenClaw 启动）优先迁移，确保这些高频错误场景有完整元数据

---

## 6. 后端实现

### 6.1 自定义 JSON Formatter（新建 `src-tauri/src/core/logger/json_formatter.rs`）

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

        // 解析前端传来的 |META| 分隔格式
        const META_DELIMITER: &str = " |META|";
        let (msg, meta) = if let Some(idx) = raw_msg.find(META_DELIMITER) {
            let (msg_part, meta_part) = raw_msg.split_at(idx);
            let meta_json = &meta_part[META_DELIMITER.len()..];
            (msg_part.trim(), Some(meta_json))
        } else {
            (raw_msg.as_str(), None)
        };

        // JSON 字符串转义 msg
        let escaped_msg = escape_json(msg);

        if let Some(meta_json) = meta {
            write!(
                f,
                r#"{{"ts":"{ts}","level":"{level}","target":"{target}","msg":"{escaped_msg}","meta":{meta_json}}}"#
            )
        } else {
            write!(
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

### 6.2 模块入口（新建 `src-tauri/src/core/logger/mod.rs`）

```rust
pub mod json_formatter;

pub use json_formatter::JsonFormatter;
```

### 6.3 修改 `src-tauri/src/lib.rs`

替换 `tauri-plugin-log` 的 Builder 配置：

```rust
.use(|app| {
    app.handle().plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Debug)
            .format(crate::core::logger::JsonFormatter)
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
    Ok(())
})
```

### 6.4 Cargo.toml 确认

确认 `tauri-plugin-log` 依赖已存在（当前 `Cargo.toml` 已有 `tauri-plugin-log = "2.0.0-rc"`），无需新增 Rust 依赖。

**注意**：`chrono` crate 是否已存在？需要确认。如果不存在，需要添加。

### 6.5 清理生产环境 `println!`

将 `src-tauri/src/core/modelscope/commands.rs` 中的 `println!` 替换为 `log::debug!` 或 `log::info!`，避免污染日志输出。

---

## 7. 日志轮转策略

### 7.1 策略
- **触发条件**：单个文件达到 **10MB**
- **保留数量**：**5** 个历史文件
- **命名规则**：
  - 当前：`app.jsonl`
  - 轮转后：`app.jsonl.1` → `app.jsonl.2` → ... → `app.jsonl.5`
  - 当 `app.jsonl.5` 存在时，新的轮转会删除最旧的文件

### 7.2 实现方式

`tauri-plugin-log` v2 的 `RotationStrategy` 枚举：
- `RotationStrategy::KeepAll` — 不轮转
- `RotationStrategy::KeepOne` — 只保留一个文件

内置策略不满足「按大小轮转 + 保留 5 个」的需求，因此**自建简单轮转逻辑**：

在 `src-tauri/src/core/logger/` 中添加 `rotation.rs`：

```rust
use std::fs;
use std::path::Path;

const MAX_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const MAX_BACKUPS: u32 = 5;

pub fn rotate_if_needed(log_dir: &Path, file_name: &str) -> std::io::Result<()> {
    let current = log_dir.join(format!("{}.jsonl", file_name));
    if !current.exists() {
        return Ok(());
    }
    let metadata = fs::metadata(&current)?;
    if metadata.len() < MAX_SIZE_BYTES {
        return Ok(());
    }

    // 删除最旧的备份
    let oldest = log_dir.join(format!("{}.jsonl.{}", file_name, MAX_BACKUPS));
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }

    // 依次重命名备份文件
    for i in (1..MAX_BACKUPS).rev() {
        let src = log_dir.join(format!("{}.jsonl.{}", file_name, i));
        let dst = log_dir.join(format!("{}.jsonl.{}", file_name, i + 1));
        if src.exists() {
            fs::rename(src, dst)?;
        }
    }

    // 当前文件变为 .1
    fs::rename(&current, log_dir.join(format!("{}.jsonl.1", file_name)))?;
    Ok(())
}
```

在 `lib.rs` 的 `.setup()` 中，初始化插件前调用轮转检查：

```rust
let log_dir = get_jan_data_folder_path(app.handle().clone()).join("logs");
crate::core::logger::rotate_if_needed(&log_dir, "app")?;
```

---

## 8. 文件清单

| # | 文件路径 | 动作 | 说明 |
|---|----------|------|------|
| 1 | `web-app/package.json` | 修改 | 添加 `@tauri-apps/plugin-log` 依赖 |
| 2 | `web-app/src/lib/logger.ts` | **新建** | 前端日志工具函数（`logError`/`logWarn`/`logInfo`） |
| 3 | `web-app/src/lib/invoke-logger.ts` | **新建** | Tauri invoke 包装器，自动记录失败 |
| 4 | `web-app/src/main.tsx` | 修改 | 初始化 `attachConsole` + 全局错误捕获 |
| 5 | `web-app/src/containers/GlobalError.tsx` | 修改 | Error Boundary 中调用 `logError` |
| 6 | `src-tauri/src/core/logger/mod.rs` | **新建** | Logger 模块入口 |
| 7 | `src-tauri/src/core/logger/json_formatter.rs` | **新建** | 自定义 JSON Lines Formatter |
| 8 | `src-tauri/src/core/logger/rotation.rs` | **新建** | 按大小轮转逻辑 |
| 9 | `src-tauri/src/core/mod.rs` | 修改 | 注册 `logger` 子模块 |
| 10 | `src-tauri/src/lib.rs` | 修改 | 替换 tauri-plugin-log 配置，调用轮转检查 |
| 11 | `src-tauri/src/core/modelscope/commands.rs` | 修改 | 将 `println!` 替换为 `log::debug!` |
| 12 | `web-app/src/hooks/useOpenClaw.ts` | 可选修改 | 关键路径用 `logError` 替代 `console.error` |
| 13 | `web-app/src/hooks/useOllamaStatus.ts` | 可选修改 | 关键路径用 `logError` 替代 `console.error` |

---

## 9. 测试策略

### 9.1 手动测试清单

1. **后端日志格式验证**
   - 启动应用，检查 `<jan_data>/logs/app.jsonl` 是否存在
   - 确认每一行都是合法 JSON
   - 确认 Rust `log::info!` / `error!` 输出格式正确

2. **前端全局错误捕获**
   - 在浏览器 console 执行 `throw new Error("test")`
   - 检查日志文件中出现 `"target":"frontend/global-error"` 的记录
   - 确认 `meta.stack` 和 `meta.url` 存在

3. **unhandledrejection 捕获**
   - 执行 `Promise.reject(new Error("test"))`
   - 检查 `"target":"frontend/unhandledrejection"`

4. **Tauri invoke 失败**
   - 触发一个会失败的 Tauri command（如 Ollama 未启动时调用 `ollama_run_model`）
   - 检查 `"target":"frontend/invoke"` 和 `meta.command`

5. **日志轮转**
   - 手动创建一个大于 10MB 的 `app.jsonl`
   - 重启应用，确认文件被轮转为 `app.jsonl.1`，新 `app.jsonl` 为空

6. **AI 读取验证**
   - 模拟出错场景后，让 AI 读取 `app.jsonl`
   - 验证 AI 能准确提取错误信息、堆栈、时间戳

### 9.2 回归测试

- `yarn build:web` 通过（无 TS 错误）
- `cargo check` 通过（无编译错误）
- `yarn tauri build` 通过（完整构建成功）
- 应用启动正常，无日志初始化报错

---

## 10. 风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|----------|
| `attachConsole` 性能开销 | 高频 console 调用导致 IPC 压力 | 仅开发阶段使用；生产构建可关闭（后续可配置） |
| 日志文件无限增长 | 磁盘占满 | 10MB 轮转 + 保留 5 个 = 最大 60MB |
| JSON 解析失败（Formatter bug） | 日志损坏 | 消息中的 `"` 和 `\n` 必须转义；写单测验证 escape_json |
| 前端 `meta` 中包含循环引用 | `JSON.stringify` 抛出 | 在 `logError` 中 `try/catch`，失败时降级为纯文本消息 |
| chrono 未在 Cargo.toml 中 | 编译失败 | 实现前检查依赖，如缺则添加 `chrono = { version = "0.4", features = ["clock"] }` |

---

## 11. 后续优化（非本次范围）

- 生产环境可配置关闭前端日志采集（减少性能开销）
- 日志级别热切换（开发时动态调整 Debug/Info）
- 前端内嵌日志查看器页面（如用户后续需要）
- 日志上传到远程（如需要远程诊断）
