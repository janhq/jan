# Jan - 把你的电脑变成人工智能电脑

![Jan banner](https://github.com/janhq/jan/assets/89722390/35daac7d-b895-487c-a6ac-6663daaad78e)

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://jan.ai/guides">入门</a> 
  - <a href="https://jan.ai/docs">文档</a> 
  - <a href="https://github.com/janhq/jan/releases">变更日志</a> 
  - <a href="https://github.com/janhq/jan/issues">Bug 报告</a> 
  - <a href="https://discord.gg/AsJ8krTT3N">讨论</a>
  - <a href="https://github.com/NHPT/jan/blob/dev/README.md">English</a>
</p>

>[!Warning]
>**Jan目前正在开发中**: 预计会有破坏性变更和错误！

Jan 是一个开源的ChatGPT替代品，在您的计算机上100%离线运行。

**Jan可以在任何硬件上运行。** 从PC到多GPU集群，Jan支持通用架构：

- [x] NVIDIA GPUs (fast)
- [x] Apple M-series (fast)
- [x] Apple Intel
- [x] Linux Debian
- [x] Windows x64

## 下载

<table>
  <tr style="text-align:center">
    <td style="text-align:center"><b>版本类型</b></td>
    <td style="text-align:center"><b>Windows</b></td>
    <td colspan="2" style="text-align:center"><b>MacOS</b></td>
    <td colspan="2" style="text-align:center"><b>Linux</b></td>
  </tr>
  <tr style="text-align:center">
    <td style="text-align:center"><b>稳定版（推荐）</b></td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/latest/win-x64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/windows.png' style="height:14px; width: 14px" />
        <b>jan.exe</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/latest/mac-x64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/mac.png' style="height:15px; width: 15px" />
        <b>Intel</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/latest/mac-arm64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/mac.png' style="height:15px; width: 15px" />
        <b>M1/M2/M3/M4</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/latest/linux-amd64-deb'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/linux.png' style="height:14px; width: 14px" />
        <b>jan.deb</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/latest/linux-amd64-appimage'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/linux.png' style="height:14px; width: 14px" />
        <b>jan.AppImage</b>
      </a>
    </td>
  </tr>
  <tr style="text-align:center">
    <td style="text-align:center"><b>实验版（每晚构建）</b></td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/nightly/win-x64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/windows.png' style="height:14px; width: 14px" />
        <b>jan.exe</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/nightly/mac-x64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/mac.png' style="height:15px; width: 15px" />
        <b>Intel</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/nightly/mac-arm64'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/mac.png' style="height:15px; width: 15px" />
        <b>M1/M2/M3/M4</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/nightly/linux-amd64-deb'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/linux.png' style="height:14px; width: 14px" />
        <b>jan.deb</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://app.jan.ai/download/nightly/linux-amd64-appimage'>
        <img src='https://github.com/janhq/docs/blob/main/static/img/linux.png' style="height:14px; width: 14px" />
        <b>jan.AppImage</b>
      </a>
    </td>
  </tr>
</table>

在 https://jan.ai/ 页面下载 Jan 的最新版本或访问 **[GitHub Releases](https://github.com/janhq/jan/releases)** 下载任何以前的版本。
## 演示

![Demo](/demo.gif)

_实时视频： Jan v0.4.3-nightly on a Mac M1, 16GB Sonoma 14_

## 快速链接

#### Jan

- [Jan website](https://jan.ai/)
- [Jan GitHub](https://github.com/janhq/jan)
- [User Guides](https://jan.ai/guides/)
- [Developer docs](https://jan.ai/developer/)
- [API reference](https://jan.ai/api-reference/)
- [Specs](https://jan.ai/docs/)

#### Nitro

Nitro 是一个轻量级和可嵌入的用于边缘计算的高效 C++ 推理引擎。它可以在您自己的项目中单独使用。

- [Nitro Website](https://nitro.jan.ai)
- [Nitro GitHub](https://github.com/janhq/nitro)
- [Documentation](https://nitro.jan.ai/docs)
- [API Reference](https://nitro.jan.ai/api-reference)

## 故障排除

由于Jan处于开发模式，您可能会被困在一个损坏的构建上。

要重置安装，请执行以下操作：

1. 使用以下命令删除任何挂起的后端进程：

   ```sh
   ps aux | grep nitro
   ```

   查找“nitro”和“nitro_arm_64”等进程，并用以下命令逐一杀死它们：

   ```sh
   kill -9 <PID>
   ```

2. **从“应用程序”目录和“缓存”目录中删除 Jan**

   ```bash
   make clean
   ```

   这将删除所有构建工件和缓存文件：

   - 从`~/Jan/dextensions`目录中删除Jan扩展名
   - 在当前目录删除所有 `node_modules`
   - 清除应用程序缓存 `~/Library/Caches/jan`

## 运行 Jan 的要求

- MacOS: 13 或更高版本
- Windows:
  - Windows 10 或更高版本
  - To enable GPU support:
    - Nvidia GPU with CUDA Toolkit 11.7 或更高版本
    - Nvidia driver 470.63.01 或更高版本
- Linux:
  - glibc 2.27 或更高版本 (使用`ldd --version`命令进行检查)
  - gcc 11, g++ 11, cpp 11 或更高版本, 有关更多信息，请参阅此内容 [link](https://jan.ai/guides/troubleshooting/gpu-not-used/#specific-requirements-for-linux) 
  - 启用 GPU 支持:
    - Nvidia GPU with CUDA Toolkit 11.7 或更高版本
    - Nvidia driver 470.63.01 或更高版本

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 文件

### 先决条件

- node >= 20.0.0
- yarn >= 1.22.0
- make >= 3.81

### 说明

1. **克隆存储库并准备：**

   ```bash
   git clone https://github.com/janhq/jan
   cd jan
   git checkout -b DESIRED_BRANCH
   ```

2. **运行开发服务器并使用 Jan 桌面版**

   ```bash
   make dev
   ```

这将启动开发服务器并打开桌面应用程序。

3. (可选) **运行不带前端的 API 服务器**

   ```bash
   yarn dev:server
   ```

### 用于生产建设

```bash
# 执行上一节中的步骤 1 和 2
# 构建应用程序
make build
```

这将构建用于生产的应用程序 MacOS m1/m2（已完成代码签名），并将结果放入`dist`目录中。

### Docker 模式

- 支持的操作系统: Linux, WSL2 Docker
- 先决条件:

  - 在 Docker 模式下运行 Jan 需要 Docker Engine 和 Docker Compose。 按照以下 [说明](https://docs.docker.com/engine/install/ubuntu/) 在 Ubuntu 上开始使用 Docker Engine。

    ```bash
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh ./get-docker.sh --dry-run
    ```

  - 如果你打算在GPU模式下运行Jan，你需要安装 `nvidia-driver` 和 `nvidia-docker2` 驱动程序. Follow the instruction [here](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) for installation.

- 在 Docker 模式下运行 Jan
  > User can choose between `docker-compose.yml` with latest prebuilt docker image or `docker-compose-dev.yml` with local docker build
  > 用户可以通过`docker-compose.yml`选择使用最新预构建的docker镜像，或通过`docker-compose-dev.yml`使用本地 docker 构建。

| Docker compose 配置文件 | 描述                                        |
| ---------------------- | -------------------------------------------- |
| `cpu-fs`               | 使用默认文件系统在 CPU 模式下运行 Jan          |
| `cpu-s3fs`             | 使用 S3 文件系统在 CPU 模式下运行 Jan          |
| `gpu-fs`               | 使用默认文件系统以 GPU 模式运行 Jan            |
| `gpu-s3fs`             | 使用 S3 文件系统以 GPU 模式运行 Jan            |

| 环境变量    |描述                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `S3_BUCKET_NAME`        | S3 存储桶名称 - 对于默认文件系统留空                                                                       |
| `AWS_ACCESS_KEY_ID`     | AWS 访问密钥 ID - 对于默认文件系统留空                                                                     |
| `AWS_SECRET_ACCESS_KEY` | AWS 秘密访问密钥 - 对于默认文件系统留空                                                                     |
| `AWS_ENDPOINT`          | AWS 端点 URL - 对于默认文件系统留空                                                                        |
| `AWS_REGION`            | AWS 区域 - 默认文件系统留空                                                                                |
| `API_BASE_URL`          | Jan Server URL，请修改为你的公网ip地址或者域名 默认为： http://localhost:1377                               |

- **选项 1**: 在 CPU 模式下运行 Jan

  ```bash
  # 默认文件系统的cpu模式
  docker compose --profile cpu-fs up -d

  # S3文件系统的cpu模式
  docker compose --profile cpu-s3fs up -d
  ```

- **选项 2**: 在 GPU 模式下运行 Jan

  - **步骤 1**: 通过运行 `NVIDIA-smi` 检查 CUDA 与 NVIDIA 驱动程序的兼容性，并在输出中检查 CUDA 版本

    ```bash
    nvidia-smi

    # Output
    +---------------------------------------------------------------------------------------+
    | NVIDIA-SMI 531.18                 Driver Version: 531.18       CUDA Version: 12.1     |
    |-----------------------------------------+----------------------+----------------------+
    | GPU  Name                      TCC/WDDM | Bus-Id        Disp.A | Volatile Uncorr. ECC |
    | Fan  Temp  Perf            Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
    |                                         |                      |               MIG M. |
    |=========================================+======================+======================|
    |   0  NVIDIA GeForce RTX 4070 Ti    WDDM | 00000000:01:00.0  On |                  N/A |
    |  0%   44C    P8               16W / 285W|   1481MiB / 12282MiB |      2%      Default |
    |                                         |                      |                  N/A |
    +-----------------------------------------+----------------------+----------------------+
    |   1  NVIDIA GeForce GTX 1660 Ti    WDDM | 00000000:02:00.0 Off |                  N/A |
    |  0%   49C    P8               14W / 120W|      0MiB /  6144MiB |      0%      Default |
    |                                         |                      |                  N/A |
    +-----------------------------------------+----------------------+----------------------+
    |   2  NVIDIA GeForce GTX 1660 Ti    WDDM | 00000000:05:00.0 Off |                  N/A |
    | 29%   38C    P8               11W / 120W|      0MiB /  6144MiB |      0%      Default |
    |                                         |                      |                  N/A |
    +-----------------------------------------+----------------------+----------------------+

    +---------------------------------------------------------------------------------------+
    | Processes:                                                                            |
    |  GPU   GI   CI        PID   Type   Process name                            GPU Memory |
    |        ID   ID                                                             Usage      |
    |=======================================================================================|
    ```

  - **步骤 2**: 查看 [NVIDIA NGC Catalog ](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/cuda/tags) 并找到与您的 CUDA 版本匹配的镜像标签的最小次要版本 (例如： 12.1 -> 12.1.0)

  - **步骤 3**: 使用步骤 2 中镜像标签的最新次要版本更新 `Dockerfile.gpu` 第 5 行 (例如： 将 `FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS base` 改为 `FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 AS base`)

  - **步骤 4**: 运行命令在 GPU 模式下启动 Jan

    ```bash
    # 默认文件系统的 GPU 模式
    docker compose --profile gpu-fs up -d

    # S3文件系统的 GPU 模式
    docker compose --profile gpu-s3fs up -d
    ```

这将启动web服务器，您可以通过`http://localhost:3000`访问 Jan。

> 注意: s3fs 的 Docker 模式尚不支持 RAG 功能。

## 致谢

Jan 在以下开源项目的基础上进行构建：

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [LangChain](https://github.com/langchain-ai)
- [TensorRT](https://github.com/NVIDIA/TensorRT)
- [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM)

## 联系我们

- Bugs & 请求: 提交GitHub票证
- 讨论: 点击此处 [加入我们的 Discord](https://discord.gg/FTk2MvZwJH)
- 商业咨询请发邮件至: hello@jan.ai
- 求职请发邮件至: email hr@jan.ai

## 信任与安全

谨防诈骗。

- 我们绝不会向您索要个人信息
- 我们是免费产品；没有付费版本
- 我们没有代币或 ICO
- 我们没有积极筹款或寻求捐赠

## 许可证

Jan 是免费且开源的，遵循 AGPLv3 许可。
