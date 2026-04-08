# Jan - 开源 ChatGPT 替代方案

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
  <strong>中文</strong>
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
  - <a href="https://discord.gg/Exe46xPMbK">社区</a>
  - <a href="https://jan.ai/changelog">更新日志</a>
  - <a href="https://github.com/janhq/jan/issues">问题反馈</a>
</p>

Jan 致力于通过易于使用的产品，将开源 AI 的精华呈现给大众。下载并运行大语言模型 (LLMs)，享有**完全的控制权**和**隐私保护**。

## 安装 (Installation)

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

最简单的入门方式是根据您的操作系统下载以下版本之一：

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
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-3734911349'>操作指南</a></td>
  </tr>
</table>


您可以从 [jan.ai](https://jan.ai/) 或 [GitHub Releases](https://github.com/janhq/jan/releases) 下载。

## 核心功能 (Features)

- **本地 AI 模型**：从 HuggingFace 下载并运行大语言模型（Llama, Gemma, Qwen, GPT-oss 等）
- **云端集成**：通过 OpenAI 连接 GPT 模型，通过 Anthropic 连接 Claude 模型，以及 Mistral, Groq 等
- **自定义助手**：为您的任务创建专门的 AI 助手
- **兼容 OpenAI 的 API**：在 `localhost:1337` 运行本地服务器，供其他应用程序调用
- **模型上下文协议 (MCP)**：集成 MCP 以实现 Agent 自动化能力
- **隐私优先**：当您需要时，所有内容均在本地运行

## 源码构建 (Build from Source)

适合喜欢探索过程的用户：

### 前置要求 (Prerequisites)

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

这将处理所有步骤：安装依赖、构建核心组件并启动应用程序。

**可用的 make 命令：**
- `make dev` - 完整的开发环境设置与启动
- `make build` - 生产版本构建
- `make test` - 运行测试和 lint 检查
- `make clean` - 清除所有生成文件并重新开始

### 手动构建命令

```bash
yarn install
yarn build:tauri:plugin:api
yarn build:core
yarn build:extensions
yarn dev
```

## 系统要求 (System Requirements)

**获得良好体验的最低配置：**

- **macOS**: 13.6+ (3B 模型需 8GB RAM，7B 需 16GB，13B 需 32GB)
- **Windows**: 10+，支持 NVIDIA/AMD/Intel Arc GPU 加速
- **Linux**: 大多数发行版均可，支持 GPU 加速

有关详细的兼容性说明，请查看我们的[安装指南](https://jan.ai/docs/desktop/mac)。

## 故障排除 (Troubleshooting)

如果运行出现问题：

1. 查看我们的[故障排除文档](https://jan.ai/docs/desktop/troubleshooting)
2. 复制您的错误日志和系统规格信息
3. 在我们的 Discord `#🆘|jan-help` 频道寻求帮助：[Discord](https://discord.gg/FTk2MvZwJH)


## 贡献 (Contributing)

欢迎参与贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 以获取完整信息。

## 相关链接 (Links)

- [文档](https://jan.ai/docs) - 建议阅读的操作手册
- [API 参考](https://jan.ai/api-reference) - 供开发者参考
- [更新日志](https://jan.ai/changelog) - 了解修复和变更内容
- [Discord](https://discord.gg/FTk2MvZwJH) - 社区所在地

## 联系我们 (Contact)

- **Bug 反馈**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **商务合作**: hello@jan.ai
- **人才招聘**: hr@jan.ai
- **综合讨论**: [Discord](https://discord.gg/FTk2MvZwJH)

## 许可证 (License)

Apache 2.0 - 因为分享即是关爱。

## 致谢 (Acknowledgements)

站在巨人的肩膀上构建：

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
