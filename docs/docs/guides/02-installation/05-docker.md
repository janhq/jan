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
    cpu mode,
    gpu mode,
  ]
---

# Installing Jan using Docker

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

### Run Jan in Docker Mode

| Docker compose Profile | Description                                  |
| ---------------------- | -------------------------------------------- |
| `cpu-fs`               | Run Jan in CPU mode with default file system |
| `cpu-s3fs`             | Run Jan in CPU mode with S3 file system      |
| `gpu-fs`               | Run Jan in GPU mode with default file system |
| `gpu-s3fs`             | Run Jan in GPU mode with S3 file system      |

| Environment Variable    | Description                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `S3_BUCKET_NAME`        | S3 bucket name - leave blank for default file system                                                    |
| `AWS_ACCESS_KEY_ID`     | AWS access key ID - leave blank for default file system                                                 |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key - leave blank for default file system                                             |
| `AWS_ENDPOINT`          | AWS endpoint URL - leave blank for default file system                                                  |
| `AWS_REGION`            | AWS region - leave blank for default file system                                                        |
| `API_BASE_URL`          | Jan Server URL, please modify it as your public ip address or domain name default http://localhost:1377 |

- **Option 1**: Run Jan in CPU mode

  ```bash
  # cpu mode with default file system
  docker compose --profile cpu-fs up -d

  # cpu mode with S3 file system
  docker compose --profile cpu-s3fs up -d
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
    # GPU mode with default file system
    docker compose --profile gpu-fs up -d

    # GPU mode with S3 file system
    docker compose --profile gpu-s3fs up -d
    ```

This will start the web server and you can access Jan at `http://localhost:3000`.

:::warning

- RAG feature is not supported in Docker mode with s3fs yet.

:::
