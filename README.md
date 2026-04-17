# 容芯AI助手 - 本地 AI 推理桌面应用

<p align="center">
  <strong>中文</strong> ·
  <a href="README.zh.md">English</a>
</p>

<p align="center">
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/rongxinzy/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/rongxinzy/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/rongxinzy/jan"/>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a>
  - <a href="#功能特性">功能特性</a>
  - <a href="#源码构建">源码构建</a>
  - <a href="#问题反馈">问题反馈</a>
</p>

容芯AI助手是一款基于 [Jan](https://github.com/janhq/jan) 深度定制的开源 AI 桌面应用，专注于为中国用户提供**本地化、私有化、零配置**的大语言模型推理体验。

> 所有数据运行在本地，不上传云端，彻底保护您的隐私。

## 快速开始

### 方式一：下载安装包（推荐）

从 [GitHub Releases](https://github.com/rongxinzy/jan/releases) 下载对应平台的安装包：

<table>
  <tr>
    <td><b>平台</b></td>
    <td><b>下载</b></td>
  </tr>
  <tr>
    <td><b>Windows (x64)</b></td>
    <td><a href='https://github.com/rongxinzy/jan/releases'>容芯AI助手_setup.exe</a></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td>敬请期待</td>
  </tr>
  <tr>
    <td><b>Linux</b></td>
    <td>敬请期待</td>
  </tr>
</table>

### 方式二：源码构建

```bash
git clone https://github.com/rongxinzy/jan.git
cd jan
yarn install
yarn tauri build
```

构建完成后，安装包位于 `src-tauri/target/release/bundle/nsis/`。

## 功能特性

- **🔌 Ollama 一键接入**：默认集成 Ollama 本地推理引擎，零配置即可使用开源大模型
- **📦 ModelScope 模型市场**：内置 ModelScope 模型搜索与发现，告别 HuggingFace 访问困难
- **🤖 多引擎支持**：支持 Ollama（默认）、llama.cpp、MLX 等多种本地推理后端
- **☁️ 云端模型兼容**：同时支持 OpenAI、Anthropic、Mistral 等云端 API
- **🔒 隐私优先**：所有推理在本地完成，数据永不离开您的设备
- **🌐 中文优化**：默认简体中文界面，针对中文模型（Qwen 系列等）深度优化
- **📡 OpenAI 兼容 API**：本地服务器 `localhost:1337`，其他应用可直接调用
- **🛠️ 自定义助手**：为不同任务创建专门的 AI 助手

## 系统要求

**推荐配置：**

- **Windows**: Windows 10/11 (64位)，8GB+ 内存，推荐 NVIDIA/AMD/Intel 独立显卡
- **macOS**: 13.6+ (Apple Silicon 推荐 16GB 内存)
- **Linux**: 主流发行版均可

> 💡 运行 7B 级别模型建议 16GB 内存，14B 级别建议 32GB 内存。小参数模型（3B/1.5B）可在 8GB 内存设备上流畅运行。

## 使用指南

### 1. 安装并启动

下载安装包后双击运行，首次启动会自动完成初始化。

### 2. 启动 Ollama（推荐）

容芯AI助手默认通过 Ollama 进行本地推理。请确保 Ollama 服务已启动：

```bash
# 安装 Ollama（如果尚未安装）
# https://ollama.com/download

# 启动 Ollama 并下载模型
ollama pull qwen2.5:7b
```

Ollama 启动后，容芯AI助手会自动检测并连接。

### 3. 从模型市场下载模型

打开「推理中心」→ 搜索 ModelScope 上的模型 → 点击下载。模型将自动下载并注册到本地。

### 4. 开始对话

选择模型 → 新建对话 → 开始与 AI 助手交流。

## 源码构建

### 前置要求

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Rust / Cargo（用于 Tauri 构建）
- Make ≥ 3.81

### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/rongxinzy/jan.git
cd jan

# 安装依赖
yarn install

# 开发模式启动
yarn dev

# 生产构建
yarn tauri build
```

### Make 命令

```bash
make dev      # 开发环境启动
make build    # 生产构建
make test     # 运行测试
make clean    # 清理构建产物
```

## 项目架构

```
容芯AI助手
├── web-app/              # React 前端应用（UI、状态管理、路由）
├── src-tauri/            # Tauri Rust 后端（系统调用、下载、文件系统）
│   └── plugins/          # Tauri 插件（llama.cpp、MLX、硬件检测等）
├── core/                 # TypeScript SDK 与扩展系统
├── extensions/           # 扩展模块（下载管理、模型引擎等）
└── web-app/public/       # 静态资源（含预置模型目录）
```

## 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS + TanStack Router
- **后端**: Rust + Tauri v2
- **本地推理**: llama.cpp / Ollama / MLX
- **构建工具**: Vite + Yarn + Cargo

## 问题反馈

遇到问题？请通过以下方式反馈：

- **Bug 报告**: [GitHub Issues](https://github.com/rongxinzy/jan/issues)
- **功能建议**: [GitHub Discussions](https://github.com/rongxinzy/jan/discussions)

## 贡献指南

欢迎参与贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与项目开发。

## 致谢

### 特别鸣谢

本项目基于 **[Jan](https://github.com/janhq/jan)** 开源项目深度定制。衷心感谢 [Jan 项目组](https://github.com/janhq/jan) 的杰出工作——他们构建了一个优秀的开源 AI 桌面应用框架，为本地大模型推理社区做出了重要贡献。

> 🙏 如果没有 Jan 团队的开源成果，容芯AI助手不可能诞生。向所有 Jan 贡献者致敬！

### 核心依赖

- [Llama.cpp](https://github.com/ggerganov/llama.cpp) - 高性能本地 LLM 推理
- [Ollama](https://ollama.com/) - 本地大模型运行框架
- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [ModelScope](https://www.modelscope.cn/) - 中文模型社区

## 许可证

Apache 2.0 - 自由使用，开放共享。

---

<p align="center">
  <i>容芯AI助手 - 让 AI 推理触手可及</i>
</p>
