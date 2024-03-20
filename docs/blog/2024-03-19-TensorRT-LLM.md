---
title: Jan now supports TensorRT-LLM
description: Jan has added for Nvidia's TensorRT-LLM, a hardware-optimized LLM inference engine that runs very fast on Nvidia GPUs
tags: [Nvidia, TensorRT-LLM]
---

Jan now supports [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) as an alternative inference engine. TensorRT-LLM is a hardware-optimized LLM inference engine that compiles models to [run extremely fast on Nvidia GPUs](https://blogs.nvidia.com/blog/tensorrt-llm-windows-stable-diffusion-rtx/).

- [TensorRT-LLM Extension](/guides/providers/tensorrt-llm) is available in [0.4.9 release](https://github.com/janhq/jan/releases/tag/v0.4.9)
- Currently available only for Windows

We've made a few TensorRT-LLM models TensorRT-LLM models available in the Jan Hub for download:

- TinyLlama-1.1b
- Mistral 7b
- TinyJensen-1.1b 😂

You can get started by following our [TensorRT-LLM Guide](/guides/providers/tensorrt-llm).

## Performance Benchmarks

TensorRT-LLM is mainly used in datacenter-grade GPUs to achieve [10,000 tokens/s](https://nvidia.github.io/TensorRT-LLM/blogs/H100vsA100.html) type speeds. Naturally, we were curious to see how this would perform on consumer-grade GPUs.

We’ve done a comparison of how TensorRT-LLM does vs. [llama.cpp](https://github.com/ggerganov/llama.cpp), our default inference engine.

| NVIDIA GPU | Architecture | VRAM Used (GB) | CUDA Cores | Tensor Cores | Memory Bus Width (bit) | Memory Bandwidth (GB/s) |
| ---------- | ------------ | -------------- | ---------- | ------------ | ---------------------- | ----------------------- |
| RTX 4090   | Ada          | 24             | 16,384     | 512          | 384                    | ~1000                   |
| RTX 3090   | Ampere       | 24             | 10,496     | 328          | 384                    | 935.8                   |
| RTX 4060   | Ada          | 8              | 3,072      | 96           | 128                    | 272                     |

- We tested using batch_size 1 and input length 2048, output length 512 as it’s the common use case people all use.
- We ran the tests 5 times to get get the Average.
- CPU, Memory were obtained from... Windows Task Manager
- GPU Metrics were obtained from `nvidia-smi` or `htop`/`nvtop`
- All tests were run on bare metal PCs with no other apps open
- There is a slight difference between the models: AWQ models for TensorRT-LLM, while llama.cpp has its own quantization technique

### RTX 4090 on Windows PC

TensorRT-LLM handily outperformed llama.cpp in for the 4090s. Interestingly,

- CPU: Intel 13th series
- GPU: NVIDIA GPU 4090 (Ampere - sm 86)
- RAM: 32GB
- OS: Windows 11 Pro

#### TinyLlama-1.1b FP16

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | No support           | ✅ 257.76    |
| VRAM Used (GB)       | No support           | 3.3          |
| RAM Used (GB)        | No support           | 0.54         |
| Disk Size (GB)       | No support           | 2            |

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 101.3                | ✅ 159       |
| VRAM Used (GB)       | 5.5                  | 6.3          |
| RAM Used (GB)        | 0.54                 | 0.42         |
| Disk Size (GB)       | 4.07                 | 3.66         |

### RTX 3090 on Windows PC

- CPU: Intel 13th series
- GPU: NVIDIA GPU 3090 (Ampere - sm 86)
- RAM: 64GB
- OS: Windows

#### TinyLlama-1.1b FP16

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | No support           | ✅ 203       |
| VRAM Used (GB)       | No support           | 3.8          |
| RAM Used (GB)        | No support           | 0.54         |
| Disk Size (GB)       | No support           | 2            |

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 90                   | 140.27       |
| VRAM Used (GB)       | 6.0                  | 6.8          |
| RAM Used (GB)        | 0.54                 | 0.42         |
| Disk Size (GB)       | 4.07                 | 3.66         |

### RTX 4060 on Windows Laptop

- Manufacturer: Acer Nitro 16 Phenix
- CPU: Ryzen 7000
- RAM: 16GB
- GPU: NVIDIA Laptop GPU 4060 (Ada)

#### TinyLlama-1.1b FP16

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 65                   | ❌ 41        |
| VRAM Used (GB)       | 2.1                  | 😱 7.6       |
| RAM Used (GB)        | 0.3                  | 😱 7.2       |
| Disk Size (GB)       | 4.07                 | 4.07 GB      |

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 22                   | ❌ 19        |
| VRAM Used (GB)       | 2.1                  | 😱 7.7       |
| RAM Used (GB)        | 0.3                  | 😱 13.5      |
| Disk Size (GB)       | 4.07                 | 4.07         |
