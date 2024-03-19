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
- TinyJensen-1.1b, which is trained on Jensen Huang's 👀

## What is TensorRT-LLM?

Please read our [TensorRT-LLM Guide](/guides/providers/tensorrt-llm). 

TensorRT-LLM is mainly used in datacenter-grade GPUs to achieve [10,000 tokens/s](https://nvidia.github.io/TensorRT-LLM/blogs/H100vsA100.html) type speeds.

## Performance Benchmarks


We were curious to see how this would perform on consumer-grade GPUs, as most of Jan's users use consumer-grade GPUs.

- We’ve done a comparison of how TensorRT-LLM does vs. llama.cpp, our default inference engine.

| NVIDIA GPU | Architecture | VRAM Used (GB) | CUDA Cores | Tensor Cores | Memory Bus Width (bit) | Memory Bandwidth (GB/s) |
| ---------- | ------------ | -------------- | ---------- | ------------ | ---------------------- | ----------------------- |
| RTX 4090   | Ada          | 24             | 16,384     | 512          | 384                    | ~1000                   |
| RTX 3090   | Ampere       | 24             | 10,496     | 328          | 384                    | 935.8                   |
| RTX 4060   | Ada          | 8              | 3,072      | 96           | 128                    | 272                     |

> We test using batch_size 1 and input length 2048, output length 512 as it’s the common use case people all use. We run 5 times and get the Average.

> We use Windows task manager and Linux NVIDIA-SMI/ Htop to get CPU/ Memory/ NVIDIA GPU metrics per process.

> We turn off all user application and only open Jan app with Nitro tensorrt-llm or NVIDIA benchmark script in python

### RTX 4090 on Windows PC

- CPU: Intel 13th series
- GPU: NVIDIA GPU 4090 (Ampere - sm 86)
- RAM: 120GB
- OS: Windows

#### TinyLlama-1.1b q4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 104                  | ✅ 131       |
| VRAM Used (GB)       | 2.1                  | 😱 21.5      |
| RAM Used (GB)        | 0.3                  | 😱 15        |
| Disk Size (GB)       | 4.07                 | 4.07         |

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 80                   | ✅ 97.9      |
| VRAM Used (GB)       | 2.1                  | 😱 23.5      |
| RAM Used (GB)        | 0.3                  | 😱 15        |
| Disk Size (GB)       | 4.07                 | 4.07         |

### RTX 3090 on Windows PC

- CPU: Intel 13th series
- GPU: NVIDIA GPU 3090 (Ampere - sm 86)
- RAM: 64GB
- OS: Windows

#### TinyLlama-1.1b q4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 131.28               | ✅ 194       |
| VRAM Used (GB)       | 2.1                  | 😱 21.5      |
| RAM Used (GB)        | 0.3                  | 😱 15        |
| Disk Size (GB)       | 4.07                 | 4.07         |

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM |
| -------------------- | -------------------- | ------------ |
| Throughput (token/s) | 88                   | ✅ 137       |
| VRAM Used (GB)       | 6.0                  | 😱 23.8      |
| RAM Used (GB)        | 0.3                  | 😱 25        |
| Disk Size (GB)       | 4.07                 | 4.07         |

### RTX 4060 on Windows Laptop

- Manufacturer: Acer Nitro 16 Phenix
- CPU: Ryzen 7000
- RAM: 16GB
- GPU: NVIDIA Laptop GPU 4060 (Ada)

#### TinyLlama-1.1b q4

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
