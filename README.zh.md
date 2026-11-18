# Jan：开源 ChatGPT 替代方案

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
  <strong>中文</strong> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://jan.ai/docs/desktop">快速开始</a>
  | <a href="https://discord.gg/Exe46xPMbK">社区</a>
  | <a href="https://jan.ai/changelog">更新日志</a>
  | <a href="https://github.com/janhq/jan/issues">Bug 反馈</a>
</p>

Jan 致力于通过易用的产品，将开源 AI 的精华带给大众。下载并运行大语言模型，享受**完全掌控**和**隐私保护**。

## 安装

<p align="center">
  <table>
    <tr>
      <!-- Microsoft Store Badge -->
      <td align="center" valign="middle">
        <a href="https://apps.microsoft.com/detail/xpdcnfn5cpzlqb">
          <img height="60"
            width="200"
               alt="从 Microsoft Store 获取"
               src="https://get.microsoft.com/images/en-us%20dark.svg"/>
        </a>
      </td>
      <!-- Spacer -->
      <td width="20"></td>
      <!-- Flathub Official Badge -->
      <td align="center" valign="middle">
        <a href="https://flathub.org/apps/ai.jan.Jan">
          <img height="60"
            width="200"
               alt="在 Flathub 上获取"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

开始使用 Jan 的最简单方式——根据您的操作系统下载以下版本之一：

<table>
  <tr>
    <td><b>平台</b></td>
    <td><b>下载链接</b></td>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><a href='https://app.jan.ai/download/latest/win-x64'>jan.exe</a></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><a href='https://app.jan.ai/download/latest/mac-universal'>jan.dmg</a></td>
  </tr>
  <tr>
    <td><b>Linux (deb)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-deb'>jan.deb</a></td>
  </tr>
  <tr>
    <td><b>Linux (AppImage)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-appimage'>jan.AppImage</a></td>
  </tr>
  <tr>
    <td><b>Linux (Arm64)</b></td>
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-4142429792'>操作指南</a></td>
  </tr>
</table>


也可从 [jan.ai](https://jan.ai/) 或 [GitHub Releases](https://github.com/janhq/jan/releases) 下载。

## 核心功能

- **本地 AI 模型**：从 HuggingFace 下载并运行大语言模型（Llama, Gemma, Qwen, GPT-oss 等）
- **云端集成**：连接 OpenAI 的 GPT、Anthropic 的 Claude 以及 Mistral, Groq 等模型
- **自定义助手**：为您的任务创建专用 AI 助手
- **兼容 OpenAI 的 API**：在 `localhost:1337` 运行本地服务器，供其他应用程序调用
- **MCP**：集成 MCP 以实现 Agent 自动化能力
- **隐私优先**：当您需要时，所有内容均在本地运行

## 从源码构建

适合喜欢探索过程的用户：

### 前置要求

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (用于 Tauri 构建)
- (仅限 macOS Apple Silicon) MetalToolchain 命令：`xcodebuild -downloadComponent MetalToolchain`

### 使用 Make 运行

```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

这将处理所有步骤：安装依赖、构建核心组件并启动应用。

**可用的 make 命令：**
- `make dev`：部署并启动完整开发环境
- `make build`：构建对外发布版本
- `make test`：运行测试和 lint 检查
- `make clean`：清除所有生成文件并重新开始

### 手动构建命令

```bash
yarn install
yarn build:tauri:plugin:api
yarn build:core
yarn build:extensions
yarn dev
```

### 在 Windows 上构建

请在 **Git Bash**（Git for Windows 自带）中运行 `make dev`——make 通过 `sh` 执行命令，因此不可用 `cmd.exe` 运行。

您**不需要**“Native Tools Command Prompt for VS 2022”。内置的 llama.cpp 引擎由 Ninja + `clang-cl` 构建，而 `clang-cl` 会自行定位 MSVC 工具链与 Windows SDK。以下为必须安装的组件 （`ninja`/`clang-cl`/`cmake` 必须添加至 `PATH`）：

- Visual Studio 2022 构建工具（MSVC x64 工作负载、Windows SDK）
- LLVM（提供 `clang-cl`）
- Ninja
- CMake
- CUDA Toolkit（只用于 `JAN_ENGINE_VARIANT=cuda12`/`cuda13` 的构建）

引擎变体由 `JAN_ENGINE_VARIANT` 指定（标记：`cpu`, `vulkan`, `metal`, `cuda12`, `cuda13`, `hip`/`rocm`，以 `-` 连接），例如：

```bash
make dev JAN_ENGINE_VARIANT=cuda13
```

`tauri-plugin-llamacpp(build)` 报错 **“nvcc fatal : Could not open output file ...fattn-...cu.obj.d”** 表示构建目录超出了 Windows 260 字符的 `MAX_PATH` 限制——nvcc 未遵守长路径启用选项。构建脚本现在会检测此情况并自动将 llama.cpp 的构建目录移至 `%LOCALAPPDATA%\jan-engine` 下的一个短目录。如您仍遇到此错误，请将 `JAN_ENGINE_BUILD_DIR` 设为一个短目录（例如 `C:\jb`）或将仓库移至更接近驱动器根目录的位置。

## 系统要求

**获得良好体验的最低配置：**

- **macOS**: 13.6+ (3B 模型需 8GB RAM，7B 需 16GB，13B 需 32GB)
- **Windows**: 10+，支持 NVIDIA/AMD/Intel Arc GPU 加速
- **Linux**: 大多数发行版均可，支持 GPU 加速

有关详细的兼容性说明，请查看我们的[安装指南](https://jan.ai/docs/desktop/mac)。

## 故障排除

如果运行出现问题：

1. 查看我们的[故障排除文档](https://jan.ai/docs/desktop/troubleshooting)
2. 复制您的错误日志和系统规格信息
3. 在我们的 Discord `#🆘|jan-help` 频道寻求帮助：[Discord](https://discord.gg/FTk2MvZwJH)


## 贡献

欢迎参与贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 以获取完整信息。

> **提示：** 请[签名您的提交](CONTRIBUTING.md#signed-commits)以便我们验证您的贡献。

## 相关链接

- [文档](https://jan.ai/docs)：建议阅读的操作手册
- [API 参考](https://jan.ai/api-reference)：供开发者参考
- [更新日志](https://jan.ai/changelog)：修复和变更内容
- [Discord](https://discord.gg/FTk2MvZwJH)：社区地址

## 联系我们

- **Bug 反馈**：[GitHub Issues](https://github.com/janhq/jan/issues)
- **商务合作**：hello@jan.ai
- **人才招聘**：hr@jan.ai
- **综合讨论**：[Discord](https://discord.gg/FTk2MvZwJH)

## 许可证

Apache 2.0：因为分享即是关爱。

## 致谢

站在巨人的肩膀上构建：

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
