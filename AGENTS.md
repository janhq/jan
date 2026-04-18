# RongxinAI - Agent Onboarding Guide

> 本文档面向 AI 编码助手。在做出任何修改前请先阅读本文。
> 本项目是基于 [Jan](https://github.com/janhq/jan) 深度定制的中国本地化 AI 桌面应用。

---

## Project Overview

**RongxinAI** 是一款基于 Jan 深度定制的开源 AI 桌面应用，专注于为中国用户提供**本地化、私有化、零配置**的大语言模型推理体验。

- **品牌名**: RongxinAI
- **上游项目**: [Jan](https://github.com/janhq/jan) by Menlo Research
- **仓库**: https://github.com/rongxinzy/jan
- **License**: Apache 2.0

RongxinAI是一款 **Tauri v2** 桌面应用（当前主要支持 Windows，macOS/Linux 待扩展）。核心定制包括：
- **Ollama 默认集成**：开箱即用，自动检测/安装 Ollama 本地推理引擎
- **ModelScope 模型市场**：替代 HuggingFace，解决国内访问问题
- **中文本地化**：默认简体中文界面，针对中文模型（Qwen 系列）优化
- **Ollama 自动安装**：Hub 页面一键下载安装 Ollama（带进度条）
- **禁用自动更新**：移除 Tauri updater，避免干扰

---

## Technology Stack

### Frontend
- **Framework**: React 19 + TypeScript 5.x
- **Build Tool**: Vite 6.x
- **Router**: TanStack Router (file-based routing in `web-app/src/routes/`)
- **Styling**: Tailwind CSS v4 + shadcn/ui (Radix UI primitives)
- **State Management**: Zustand 5.x + custom React hooks
- **Testing**: Vitest 3.x + jsdom + `@testing-library/react`

### Core SDK
- **Package**: `@janhq/core` (workspace in `core/`)
- **Role**: Shared TypeScript SDK providing the extension framework, browser API bridge, type definitions, and engine management.
- **Bundler**: Rolldown (generates ESM `dist/index.js` + type declarations)

### Backend
- **Framework**: Tauri v2 (Rust)
- **Main Crate**: `Jan` (`src-tauri/Cargo.toml`)
- **Binary**: `jan-cli` (headless CLI for serving models without the GUI)
- **Custom Modules**:
  - `core::downloads` — 文件下载（断点续传、进度事件、取消、SHA256 校验）
  - `core::ollama_installer` — Ollama 自动下载安装（新增）
  - `core::mcp` — MCP (Model Context Protocol) 集成
  - `core::server` — 本地 API 代理服务器
  - `core::threads` — 对话持久化
  - `core::updater` — 自动更新（已禁用）
- **Plugins**: 6 custom Tauri v2 plugins in `src-tauri/plugins/`:
  - `tauri-plugin-llamacpp` — GGUF model inference via `llama-server`
  - `tauri-plugin-mlx` — MLX-Swift inference (macOS Apple Silicon only)
  - `tauri-plugin-foundation-models` — Apple on-device Foundation Models
  - `tauri-plugin-hardware` — CPU/GPU/memory detection
  - `tauri-plugin-vector-db` — SQLite-based vector storage
  - `tauri-plugin-rag` — Document parsing for RAG

### Extensions
- 8 pluggable TypeScript packages in `extensions/`:
  - `assistant-extension`, `conversational-extension`, `download-extension`
  - `llamacpp-extension`, `mlx-extension`, `foundation-models-extension`
  - `rag-extension`, `vector-db-extension`

### Package Management
- **Package Manager**: Yarn 4.5.3 (Berry)
- **Workspaces**: Root (`core`, `web-app`) + `extensions/`

---

## Project Structure

```
jan/
├── web-app/                  # React frontend
│   ├── src/
│   │   ├── components/       # UI components + shadcn
│   │   ├── containers/       # Page-level containers
│   │   ├── hooks/            # Custom React hooks
│   │   │   ├── useOllamaStatus.ts      # Ollama 状态检测 + 自动安装
│   │   │   └── ...
│   │   ├── routes/           # TanStack file-based routes
│   │   │   ├── hub/          # 推理中心（模型市场）
│   │   │   │   ├── index.tsx           # Hub 首页（搜索 + Ollama 状态卡）
│   │   │   │   └── $modelId.tsx        # 模型详情页
│   │   │   └── settings/     # 设置页
│   │   ├── services/         # Business logic
│   │   │   └── models/
│   │   │       ├── default.ts          # 模型服务（ModelScope API）
│   │   │       └── types.ts            # 类型定义
│   │   ├── providers/        # React context providers
│   │   └── lib/              # Utilities
│   ├── public/
│   │   └── model_catalog.json          # 预置 ModelScope 模型目录
│   ├── vite.config.ts        # Vite config（含 MODEL_CATALOG_URL）
│   └── index.html
├── core/                     # @janhq/core SDK
├── src-tauri/                # Rust Tauri backend
│   ├── src/
│   │   ├── main.rs           # GUI entry point
│   │   ├── lib.rs            # Tauri app builder（command 注册）
│   │   ├── bin/jan-cli.rs    # Headless CLI
│   │   └── core/             # Core modules
│   │       ├── downloads/    # 下载模块（断点续传、进度、校验）
│   │       │   ├── commands.rs
│   │       │   ├── helpers.rs
│   │       │   └── models.rs
│   │       ├── ollama_installer/       # Ollama 自动安装（新增）
│   │       │   ├── mod.rs
│   │       │   └── commands.rs         # install_ollama command
│   │       ├── mcp/
│   │       ├── server/
│   │       └── ...
│   ├── plugins/              # 6 custom Tauri plugins
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── tauri.windows.conf.json         # Windows 打包配置（NSIS only）
├── extensions/               # 8 pluggable extensions
├── docs/                     # Documentation
├── README.md                 # 中文主文档
├── README.zh.md              # 英文副文档
└── package.json
```

---

## 核心定制化模块

### 1. Ollama 集成（默认 Provider）

**文件位置：**
- `web-app/src/constants/providers.ts` — `predefinedProviders` 中注入 `ollama` provider
- `web-app/src/hooks/useModelProvider.ts` — 默认选中 `ollama`（原 `llamacpp`）
- `web-app/src/providers/DataProvider.tsx` — `registerRemoteProvider` 跳过 Ollama 的 API key 检查

**原理：** Jan 的 `ModelFactory.createModel()` 对未知 provider name 走 `default` case → `createOpenAICompatibleModel()`。Ollama 原生支持 `/v1/chat/completions`，所以无需改动 Chat 核心。

### 2. ModelScope 模型市场

**文件位置：**
- `web-app/public/model_catalog.json` — 预置 6 个验证过的 ModelScope GGUF 模型
- `web-app/src/services/models/default.ts` — `fetchModelScopeRepo()` + `convertMsRepoToCatalogModel()`
- `web-app/src/services/models/types.ts` — `ModelScopeRepo` 接口
- `web-app/src/routes/hub/index.tsx` / `$modelId.tsx` — ModelScope 搜索/详情

**下载 URL 格式：**
```
https://www.modelscope.cn/models/{ns}/{name}/resolve/master/{filename}.gguf
```
复用 Jan 现有 `download_files` command（断点续传、进度推送、取消、SHA256 校验）。

### 3. Ollama 自动安装

**文件位置：**
- `src-tauri/src/core/ollama_installer/commands.rs` — `install_ollama` command
- `web-app/src/hooks/useOllamaStatus.ts` — 安装状态 + 进度监听
- `web-app/src/routes/hub/index.tsx` — 状态卡片 UI

**流程：**
```
Hub 页面 → Ollama 未启动 → 显示"一键安装"按钮
  → 点击 → invoke('install_ollama')
    → Rust 检查 %TEMP%\OllamaSetup.exe 是否存在
      → 存在 → 跳过下载，直接安装
      → 不存在 → 流式下载（每 1MB emit 进度事件）
    → OllamaSetup.exe /S 静默安装
    → 安装完成 → 前端自动刷新 Ollama 状态
```

### 4. 本地化适配

**已本地化内容：**
- 品牌名："RongxinAI"
- 默认语言：zh-CN
- GitHub/官网链接替换为 `rongxinzy/jan`
- 侧边栏："推理中心" 替代 "Hub"
- 设置页：隐藏 HuggingFace Token，替换为 ModelScope
- 禁用自动更新：`AUTO_UPDATER_DISABLED = true`

---

## Build & Development Commands

所有命令在 `jan/` 目录下执行。

### 生产构建
```bash
yarn tauri build
```
构建产物：`src-tauri/target/release/bundle/nsis/Jan_0.6.599_x64-setup.exe`

> **注意：** 仅保留 NSIS 打包（MSI 已移除），避免 WiX `light.exe` 中文/权限错误。

### 开发启动
```bash
make dev
# 或
yarn dev
```

### TypeScript 检查
```bash
cd web-app && yarn tsc --noEmit
```

### Rust 检查
```bash
cd src-tauri && cargo check
```

### Prerequisites
- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Rust / Cargo（用于 Tauri）
- Make ≥ 3.81

---

## 新增/修改的关键文件清单

### 前端（TypeScript/React）
| 文件 | 说明 |
|------|------|
| `web-app/public/model_catalog.json` | 预置 ModelScope 模型目录 |
| `web-app/src/hooks/useOllamaStatus.ts` | Ollama 状态检测 + 自动安装调用 |
| `web-app/src/routes/hub/index.tsx` | Hub 首页（搜索 + Ollama 状态卡 + 一键安装） |
| `web-app/src/routes/hub/$modelId.tsx` | 模型详情页（ModelScope API） |
| `web-app/src/services/models/default.ts` | ModelScope API 封装 + 转换逻辑 |
| `web-app/src/services/models/types.ts` | `ModelScopeRepo` 等类型 |
| `web-app/src/constants/providers.ts` | 预定义 Ollama provider |
| `web-app/src/hooks/useModelProvider.ts` | 默认选中 `ollama` |
| `web-app/src/providers/DataProvider.tsx` | Ollama 跳过 API key 检查 |
| `web-app/src/routes/settings/general.tsx` | 隐藏 HF Token，替换链接 |
| `web-app/src/locales/zh-CN/*.json` | 中文翻译更新 |
| `web-app/vite.config.ts` | `MODEL_CATALOG_URL` 改为本地文件 |

### 后端（Rust）
| 文件 | 说明 |
|------|------|
| `src-tauri/src/core/ollama_installer/mod.rs` | 模块入口 |
| `src-tauri/src/core/ollama_installer/commands.rs` | `install_ollama` command（下载+安装） |
| `src-tauri/src/core/mod.rs` | 注册 `ollama_installer` 模块 |
| `src-tauri/src/lib.rs` | 注册 `install_ollama` Tauri command |
| `src-tauri/tauri.windows.conf.json` | 仅保留 NSIS 打包 |

### 文档
| 文件 | 说明 |
|------|------|
| `README.md` | 中文主文档（品牌、功能、使用指南） |
| `README.zh.md` | 英文简要文档 |

---

## Code Style Guidelines

### TypeScript / JavaScript
- **TypeScript required**. No plain JavaScript.
- **Linting**: ESLint 9 + Prettier (`web-app/eslint.config.js`)
- **React**: Functional components only
- **Typing**: Proper typing enforced; avoid `any`
- **未使用变量**：项目对 `TS6133` 严格，任何未使用的 import/variable 都会导致构建失败

### Rust
- **Formatting**: `cargo fmt`
- **Linting**: `cargo clippy`
- **Error handling**: Use `Result<T, E>`; avoid panics

### 外部 API 字段透传原则（可靠性 > 风格）

对于映射外部第三方 API（如 ModelScope、HuggingFace）的数据结构，**全链路保持 API 原始字段名**，禁止使用 `#[serde(rename)]`、`#[serde(alias)]` 或 `rename_all` 做人为的风格转换。

**原因**：
- 减少转换层级 = 减少出错概率。serde 的 rename/alias 配置一旦与 API 实际返回不符（如字段缺失、大小写变化），会导致整个结构反序列化失败。
- 调试时可以逐字节对比 API 响应和代码字段，定位问题极快。
- API 是真相来源。当服务端升级改了字段名时，透传设计只需要改一处，而不是在 Rust、前端各自修 rename 映射。

**具体规则**：

1. **Rust 层**：struct 字段名与 API JSON key 完全一致。
   - ModelScope 内部 API 返回 PascalCase（如 `Name`, `IsLFS`, `ReadMeContent`）→ Rust 直接用 PascalCase 字段名。
   - ModelScope OpenAPI 返回 snake_case / camelCase（如 `display_name`, `created_at`）→ Rust 保持 snake_case。
   - 允许在文件顶部使用 `#![allow(non_snake_case)]` 抑制相关 warning。

2. **前端 TS 层**：与 Rust 返回的字段名保持一致，不做二次 camelCase 转换。
   - 例如 Rust 返回 `{ "Name": "...", "IsLFS": true }`，前端接口就写成 `Name: string; IsLFS: boolean`，不要转成 `name / isLfs`。

3. **应用层转换**：如果需要在 UI 或业务逻辑中使用更友好的命名，在**应用层**（如 `convertMsRepoToCatalogModel`）做显式字段映射，而不是在 serde 层隐式转换。

**反例（禁止）**：
```rust
// ❌ 禁止：用 alias/rename 做风格转换
#[serde(alias = "Name")]
pub name: String,
#[serde(alias = "IsLFS")]
pub is_lfs: bool,
```

**正例（推荐）**：
```rust
// ✅ 推荐：与 API 字段名完全一致
#![allow(non_snake_case)]

pub struct ModelScopeFile {
    pub Name: String,
    pub Path: String,
    pub Size: i64,
    pub Sha256: Option<String>,
    pub IsLFS: bool,
}
```

### Git Conventions
- **Target branch**: `main`
- **Commit messages**: Use conventional commits:
  - `feat: add Ollama auto-installer`
  - `fix: resolve ModelScope download URL`
  - `docs: update README`

---

## Security Considerations

- **Local-First**: 所有推理在本地完成，数据不上传云端
- **Ollama 安装器下载**: 从 `https://ollama.com/download/OllamaSetup.exe` 官方源下载，写入 `%TEMP%` 后执行 `/S` 静默安装
- **路径安全**: Jan 下载模块通过 `resolve_path_within_jan_data_folder` 限制写入范围，Ollama 安装器写入 `%TEMP%`（不受此限制）
- **CSP**: Tauri `tauri.conf.json` 定义 Content Security Policy

---

## Troubleshooting

| 问题 | 解决方案 |
|------|---------|
| `yarn tauri build` 报 WiX 权限错误 | 已移除 MSI 打包，保留 NSIS only |
| TypeScript `TS6133` 构建失败 | 移除未使用的 import/variable |
| Ollama 安装失败 | 检查 `%TEMP%` 目录权限，或手动下载安装 |
| ModelScope API 404 | 确认 model ID 格式为 `namespace/name` |

---

## Acknowledgements

本项目基于 [Jan](https://github.com/janhq/jan) 开源项目深度定制。感谢 Jan 团队的杰出工作。

---

When in doubt, run `make clean` followed by `make dev` to get back to a known good state.
