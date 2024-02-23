---
title: Docker
slug: /install/docker
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
    docker installation,
  ]
---

# Installing Jan using Docker

## Installation

### Pre-requisites

:::note

**Supported OS**: Linux, WSL2 Docker

:::

- Docker Engine and Docker Compose are required to run Jan in Docker mode. Follow the [instructions](https://docs.docker.com/engine/install/ubuntu/) below to get started with Docker Engine on Ubuntu.

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh ./get-docker.sh --dry-run
```

- If you intend to run Jan in GPU mode, you need to install `nvidia-driver` and `nvidia-docker2`. Follow the instruction [here](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) for installation.

### Instructions

- Run Jan in Docker mode

  - **Option 1**: Run Jan in CPU mode

    ```bash
    docker compose --profile cpu up -d
    ```

  - **Option 2**: Run Jan in GPU mode

    - **Step 1**: Check CUDA compatibility with your NVIDIA driver by running `nvidia-smi` and check the CUDA version in the output

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

    - **Step 2**: Visit [NVIDIA NGC Catalog ](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/cuda/tags) and find the smallest minor version of image tag that matches your CUDA version (e.g., 12.1 -> 12.1.0)

    - **Step 3**: Update the `Dockerfile.gpu` line number 5 with the latest minor version of the image tag from step 2 (e.g. change `FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS base` to `FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 AS base`)

    - **Step 4**: Run command to start Jan in GPU mode

      ```bash
      # GPU mode
      docker compose --profile gpu up -d
      ```

  This will start the web server and you can access Jan at `http://localhost:3000`.

:::warning

- Docker mode is currently only suitable for development and localhost. Production is not supported yet, and the RAG feature is not available in Docker mode.

:::
