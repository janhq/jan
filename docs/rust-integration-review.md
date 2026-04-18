# Rust 后端 × 前端集成设计审查报告

**审查范围**：`ollama_control_plane` 模块 + 推理中心（Hub）前端  
**审查日期**：2026-04-18  
**审查人**：Rust 架构师（AI Agent）  
**综合评分**：**2.5 / 5**（Rust 侧架构良好，前端集成存在大量 TODO 占位、重复轮询及内存泄漏风险）

---

## 1. 命令注册验证

### 1.1 注册状态

| 命令 | `lib.rs` Desktop | `lib.rs` Mobile | 前端是否调用 | 状态 |
|------|------------------|-----------------|--------------|------|
| `check_ollama_installed` | ✅ | ✅ | `useOllamaStatus.ts` invoke | 正常 |
| `check_ollama_running` | ✅ | ✅ | `useOllamaStatus.ts` invoke | 正常 |
| `start_ollama` | ✅ | ✅ | `useOllamaStatus.ts` invoke | 正常 |
| `install_ollama` | ✅ | ✅ | `useOllamaStatus.ts` invoke | 正常 |
| `ollama_show_model` | ✅ | ✅ | ❌ 未调用（仅有 TODO） | **孤儿命令** |
| `ollama_pull_model` | ✅ | ✅ | ❌ 未调用（前端用模拟数据） | **孤儿命令** |
| `ollama_delete_model` | ✅ | ✅ | ❌ 未调用（前端用模拟数据） | **孤儿命令** |
| `ollama_copy_model` | ✅ | ✅ | ❌ 未调用 | **孤儿命令** |
| `ollama_create_model` | ✅ | ✅ | ❌ 未调用 | **孤儿命令** |
| `ollama_ps` | ✅ | ✅ | ❌ 未调用（前端返回空数组） | **孤儿命令** |
| `stop_ollama` | ✅ | ✅ | ❌ 未调用（前端 OpenClaw 占位里引用） | **孤儿命令** |
| `ollama_run_model` | ❌ 未注册 | ❌ 未注册 | `hub/index.tsx` TODO 引用 | **缺失命令** |
| `ollama_unload_model` | ❌ 未注册 | ❌ 未注册 | `hub/index.tsx` TODO 引用 | **缺失命令** |

### 1.2 发现的问题

#### ❌ 问题 1.1：前端大量 TODO，Rust 命令处于"孤儿"状态
- `hub/index.tsx` 中 `handlePull`、`handleDelete`、`handleRun`、`handleUnload`、`fetchRunningModels` 均使用 `// TODO: invoke(...)` + `setTimeout` 模拟，未真正调用 Rust 命令。
- 后果：Rust 侧已完整实现拉取、删除、PS、创建等能力，但用户在前端操作无任何实际效果。

#### ❌ 问题 1.2：Mobile Handler 注册了不可用的命令
- `lib.rs` 的 Mobile（Android/iOS）handler 中注册了全部 `ollama_control_plane` 命令。
- 这些命令全部指向 `127.0.0.1:11434`，在移动端无法访问（Ollama 不支持移动平台）。
- `stop_ollama` 在移动端会落入 `#[cfg(not(target_os = "windows"))]` 分支，尝试执行 `pkill -f ollama`，在 Android/iOS 上行为未定义。

#### ❌ 问题 1.3：缺少 `ollama_run_model` / `ollama_unload_model`
- 前端 `handleRun` 和 `handleUnload` 注释中期待这两个命令，但 Rust 侧完全未实现。
- Ollama 官方 API 中可通过 `POST /api/generate` + `keep_alive` 预加载模型，或通过 `POST /api/generate` + `"keep_alive": 0` 卸载。需要补充实现。

---

## 2. 事件流验证

### 2.1 `/api/pull` 流式 JSONL 处理

Rust 侧实现（`commands.rs` 第 204-217 行）：
- 使用 `res.bytes_stream()` + `futures_util::StreamExt`
- 将 chunk 写入 `buffer`，按 `\n` 分割，逐行解析 JSON
- 解析成功后 emit `ollama-pull-progress`
- 流结束后调用 `emit_remaining_progress` 处理尾部无换行数据

**结论**：✅ 实现正确，能够处理 JSONL 分片跨 chunk 的情况。

### 2.2 事件数据结构一致性

Rust 侧 `PullProgress`（`models.rs`）：
```rust
pub struct PullProgress {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}
```

前端 `PullProgress`（`hub/index.tsx`）：
```ts
interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}
```

**结论**：✅ 字段名与可选性完全一致。

### 2.3 事件清理与内存泄漏风险

#### ❌ 问题 2.1：`hub/index.tsx` Pull 监听器存在泄漏风险
- `handlePull` 中通过 `listen<PullProgress>('ollama-pull-progress', ...)` 注册监听器，并存入 `unlistenPullRef`。
- 清理仅在 `handlePull` 的 `finally` 块中进行。
- **风险**：若用户在拉取过程中关闭 Dialog 或切换路由导致组件卸载，React 不会等待异步 `finally` 执行，监听器将永久泄漏。
- **建议**：应在 `useEffect` 的 cleanup 中检查并执行 `unlistenPullRef.current()`。

```ts
useEffect(() => {
  return () => {
    if (unlistenPullRef.current) {
      unlistenPullRef.current()
      unlistenPullRef.current = null
    }
  }
}, [])
```

#### ⚠️ 问题 2.2：`useOllamaStatus.ts` 安装监听器清理时机
- `installOllama` 在 `finally` 中清理 `ollama-install-progress` 监听器，逻辑正确。
- `useEffect` 返回函数也清理 `unlistenRef`，逻辑正确。
- 但 `installOllama` 中 `setTimeout(() => fetchStatus(), 3000)` 在组件卸载后仍会执行，可能导致 React 状态更新警告。

---

## 3. 错误处理验证

### 3.1 Rust 错误类型一致性

- 所有 `ollama_control_plane` 命令均返回 `Result<T, String>`。
- 统一使用 `err_to_string` 辅助函数将各类错误转换为字符串。
- 部分命令（如 `ollama_delete_model`、`ollama_copy_model`、`ollama_create_model`）在 HTTP 非 2xx 时返回包含 body 的详细错误信息，体验较好。

**结论**：✅ 错误类型统一。

### 3.2 前端 try-catch 覆盖

| 调用点 | try-catch | 说明 |
|--------|-----------|------|
| `check_ollama_installed` | ✅ | `useOllamaStatus.ts` |
| `check_ollama_running` | ✅ | `useOllamaStatus.ts` |
| `start_ollama` | ✅ | `useOllamaStatus.ts` |
| `install_ollama` | ✅ | `useOllamaStatus.ts` |
| `ollama_pull_model` | ❌ | 前端未实际调用 |
| `ollama_delete_model` | ❌ | 前端未实际调用 |
| `ollama_ps` | ❌ | 前端未实际调用 |

**结论**：对已激活的调用有 try-catch；对 TODO 代码无法评估。

### 3.3 Ollama 未运行时的降级处理

- `check_ollama_running`：当请求失败或返回非 2xx 时，**不返回 Err**，而是返回 `Ok(OllamaRunningStatus { is_running: false, ... })`。这是优秀设计，避免前端因网络抖动而报错。
- `ollama_ps`：当 Ollama 未运行时返回 `Err(...)`。但前端 `fetchRunningModels` 有前置守卫 `if (!ollamaRunning) return`，实际不会调用。
- `ollama_show_model` / `ollama_pull_model` 等：在 Ollama 未运行时返回 HTTP 错误字符串。

#### ❌ 问题 3.1：`ollama_ps` 竞态条件
- 前端通过 `ollamaRunning` 状态判断是否调用 `ollama_ps`，但 `ollamaRunning` 与 `ollama_ps` 调用之间存在时间窗口。
- 若用户在此期间停止 Ollama，`ollama_ps` 将返回 Err，前端 `fetchRunningModels` 的 catch 块会将其静默处理（`setRunningModels([])`），体验尚可，但 console 会打印错误。

---

## 4. 性能验证

### 4.1 `ollama_ps` 轮询间隔

- `hub/index.tsx` 第 489 行：`setInterval(fetchRunningModels, 15000)`（15 秒）。
- **结论**：✅ 15 秒间隔合理，不会给 Ollama 本地 API 造成压力。

### 4.2 重复轮询问题（严重）

#### ❌ 问题 4.1：`useOllamaStatus` 被重复实例化
- `HubContent` 调用 `useOllamaStatus(10000)`（10 秒轮询）。
- `OllamaStatusCard`（嵌套在 `HubContent` 内）调用 `useOllamaStatus(5000)`（5 秒轮询）。
- **后果**：
  1. 两个独立的 `setInterval` 同时运行，对 `check_ollama_running` 的调用频率实际为 **5 秒一次**（由较短的间隔主导）。
  2. 两个独立的状态副本可能导致 UI 短暂不一致。
  3. `OllamaStatusCard` 的 `refresh` 按钮只会刷新自身实例的状态，不会影响 `HubContent` 的模型列表。

**建议**：将 `useOllamaStatus` 提升到 `HubContent` 层级，通过 props 向下传递状态；或将其封装为 React Context。

### 4.3 流式拉取进度事件频率

- Rust 侧对每一个 chunk 都调用 `emit_progress_lines`，每解析出一行 JSON 就 emit 一次事件。
- Ollama `/api/pull` 的 JSONL 流中，每一层 blob 的下载进度都会输出一行，对于大模型可能产生 **数百至数千条** 事件。
- 前端 `hub/index.tsx` 当前使用模拟数据，无法评估真实压力；但若直接使用 `listen` + `setPullProgress`，每条事件都会触发 React re-render。

#### ⚠️ 问题 4.2：进度事件未节流
- **建议**：前端应使用 `requestAnimationFrame` 或节流函数（如 200ms 间隔）批量更新进度条，避免渲染抖动。

---

## 5. 安全验证

### 5.1 HTTP 代理绕过

- `build_client()` 和 `build_streaming_client()` 均设置了 `.no_proxy()`。
- `check_ollama_running` 中的 `reqwest::Client` 也设置了 `.no_proxy()`。
- **结论**：✅ 所有本地 Ollama 请求均绕过系统代理，避免 Windows 上 Clash 等代理（`127.0.0.1:7890`）导致请求挂死。

### 5.2 `stop_ollama` 权限风险

#### ❌ 问题 5.1：`stop_ollama` 缺乏鉴权且跨平台行为不一致
- **Windows**：使用 `taskkill /IM ollama.exe /F`（强制终止）。只能终止当前用户拥有的进程，权限风险较低。
- **非 Windows**：使用 `pkill -f ollama`。这会匹配命令行中包含 "ollama" 的**任意进程**。
  - 若用户同时运行了名为 `my-ollama-helper` 的进程，也会被误杀。
  - 在 Linux/macOS 上，`pkill -f` 的匹配范围过宽。
- **更严重**：Mobile handler 注册了 `stop_ollama`，在 Android/iOS 上会尝试执行 `pkill`，该命令通常不存在，会导致命令未找到错误。

**建议**：
1. 考虑通过 Ollama API 优雅停止（如发送特定信号），而非直接 `taskkill`/`pkill`。
2. 若必须强制终止，应通过 PID 精确匹配（`taskkill /PID <pid>` / `kill <pid>`），而非按进程名匹配。
3. 从 Mobile handler 中移除 `stop_ollama` 及相关 Ollama 命令。

### 5.3 用户输入注入风险

#### ⚠️ 问题 5.2：模型名称未做校验
- `ollama_pull_model(model)`、`ollama_delete_model(model)` 等命令直接将用户输入的字符串序列化为 JSON body 发送给 Ollama API。
- 由于使用 `serde_json::json!({"model": &model })`，不存在 JSON 注入或 Shell 注入风险。
- **但**：恶意模型名称如 `../../../etc/passwd` 可能被 Ollama 解析为路径穿越。虽然 Ollama 自身应有防护，但后端未做白名单/长度校验。

**建议**：对 `model` 参数增加基本校验：
```rust
fn validate_model_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("Invalid model name length".into());
    }
    // 仅允许字母、数字、_-:./
    if !name.chars().all(|c| c.is_alphanumeric() || "_-:./".contains(c)) {
        return Err("Invalid characters in model name".into());
    }
    Ok(())
}
```

### 5.4 `ollama_create_model` 的 Modelfile 风险

- `ollama_create_model` 接收完整的 `modelfile` 字符串并直接转发给 Ollama。
- 若前端被篡改，可能传递包含恶意指令（如 `FROM /etc/passwd`）的 Modelfile。
- **建议**：在 Rust 侧增加 Modelfile 大小限制（如最大 1MB）及基础语法校验。

---

## 6. 其他发现

### ❌ 问题 6.1：`ollama_ps` 使用 POST 而非 GET
- `commands.rs` 第 319 行：`.post(format!("{}/api/ps", OLLAMA_API_BASE))`
- Ollama 官方文档中 `/api/ps` 为 **GET** 端点。
- 当前 Ollama 实现可能兼容 POST，但这属于未定义行为，未来版本可能破坏。

### ❌ 问题 6.2：`ollama_show_model` 重复请求 `/api/tags`
- `ollama_show_model` 先调用 `/api/show`，再调用 `/api/tags` 遍历全部模型以补充 size/digest/modified_at。
- 时间复杂度为 O(n)，若本地模型数量多，每次 show 都会拉取全量列表。
- **建议**：Ollama `/api/show` 本身已返回大部分信息，可直接解析 `model_info` 中的字段，避免二次请求。

### ⚠️ 问题 6.3：事件名硬编码分散
- `ollama-pull-progress`、`ollama-create-progress`、`ollama-install-progress` 等事件名在 Rust 和 TS 文件中硬编码。
- **建议**：抽取为共享常量，避免拼写错误导致事件丢失。

---

## 7. 修复建议汇总（按优先级排序）

| 优先级 | 问题 | 修复方案 |
|--------|------|----------|
| **P0** | 前端 TODO 占位，Rust 命令未接通 | 将 `hub/index.tsx` 中的模拟逻辑替换为真实 `invoke` 调用；实现缺失的 `ollama_run_model`、`ollama_unload_model` |
| **P0** | `useOllamaStatus` 重复实例化导致双轮询 | 将状态提升为 Context 或从 `HubContent` 通过 props 传递给 `OllamaStatusCard` |
| **P1** | `hub/index.tsx` 监听器内存泄漏 | 增加 `useEffect` cleanup 处理 `unlistenPullRef`；为 `installOllama` 的 `setTimeout` 增加挂载状态检查 |
| **P1** | Mobile handler 注册了不可用的 Ollama 命令 | 将 `ollama_control_plane` 全部命令及 `stop_ollama` 从 Mobile handler 中移除；或在命令内增加 `#[cfg(desktop)]` 编译条件 |
| **P1** | `stop_ollama` 跨平台匹配过宽 | Windows 改用 PID 精确 kill；Unix 改用 PID 精确 kill；或改用 Ollama API 优雅停止 |
| **P2** | `ollama_ps` 使用 POST | 改为 `client.get(...)` |
| **P2** | 进度事件未节流 | 前端增加 100-200ms 节流；或使用 `requestAnimationFrame` 批处理 |
| **P2** | 模型名称缺乏校验 | 增加长度、字符白名单校验 |
| **P3** | `ollama_show_model` 重复请求 | 评估是否可通过 `/api/show` 单请求满足需求 |
| **P3** | 事件名硬编码 | 抽取为 `src/constants/events.ts` 共享常量 |

---

## 8. 评分细则

| 维度 | 得分 | 说明 |
|------|------|------|
| 命令注册 | 2/5 | 注册完整，但前端未调用；Mobile 注册了不可用命令；缺少 `run`/`unload` |
| 事件流 | 3/5 | JSONL 解析正确，数据结构一致，但存在内存泄漏风险和未节流问题 |
| 错误处理 | 3/5 | Rust 统一返回 String，前端对已激活调用有 try-catch，但 `ollama_ps` 有竞态 |
| 性能 | 2/5 | 15s PS 间隔合理，但存在严重的双轮询问题；进度事件未节流 |
| 安全 | 3/5 | `no_proxy()` 全面覆盖，但 `stop_ollama` 跨平台风险高，输入校验缺失 |
| **综合** | **2.5/5** | Rust 侧实现质量尚可，但前后端集成处于"半连接"状态，大量功能未真正打通 |
