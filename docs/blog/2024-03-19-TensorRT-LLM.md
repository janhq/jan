---
title: Benchmarking TensorRT-LLM vs. llama.cpp
description: Jan has added support for the TensorRT-LLM Inference Engine, as an alternative to llama.cpp. We provide a performance benchmark that shows the head-to-head comparison of the two Inference Engine and model formats, with TensorRT-LLM providing better performance but consumes significantly more VRAM and RAM. 
tags: [Nvidia, TensorRT-LLM, llama.cpp, 3090, 4090, "inference engine"]
unlisted: true
---

Jan has added support [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) as an alternative to the default [llama.cpp](https://github.com/ggerganov/llama.cpp) inference engine. TensorRT-LLM allows Nvidia GPU owners to run blazing fast LLM inference as a hardware-optimized LLM inference engine that compiles models to [run extremely fast on Nvidia GPUs](https://blogs.nvidia.com/blog/tensorrt-llm-windows-stable-diffusion-rtx/). 

You can follow our [TensorRT-LLM Guide](/guides/providers/tensorrt-llm) to try it out today. We've also added a few TensorRT-LLM models to Jan's Model Hub for download:

- Mistral 7b
- TinyLlama-1.1b
- TinyJensen-1.1b 😂

:::tip

TensorRT-LLM support is available in [v0.4.9](https://github.com/janhq/jan/releases/tag/v0.4.9), but should be considered an experimental feature. 

Please report bugs on [Github](https://github.com/janhq/jan) or on our Discord's [#tensorrt-llm](https://discord.com/channels/1107178041848909847/1201832734704795688) channel.  

:::

## Performance Benchmarks


We were really curious to see how TensorRT-LLM would perform vs. llama.cpp on consumer-grade GPUs. TensorRT-LLM has previously been shown by Nvidia to reach performance of up to [10,000 tokens/s](https://nvidia.github.io/TensorRT-LLM/blogs/H100vsA100.html) on datacenter-grade GPUs. As most of Jan's users are proud card carrying members of the [GPU Poor](https://www.semianalysis.com/p/google-gemini-eats-the-world-gemini#the-gpu-poor), we wanted to see how the two inference engine performed on the same hardware.  

:::info

An interesting aside: Jan actually started out in June 2023 building on [FastTransformer](https://github.com/NVIDIA/FasterTransformer), the precursor library to TensorRT-LLM. TensorRT-LLM was released in September 2023, making it a very young library. We're excited to see it's roadmap develop!

:::

### Test Setup

We picked 3 hardware platforms to run the test on, based on Jan's userbase's self-reported common hardware platforms. 

| NVIDIA GPU                | VRAM Used (GB) | CUDA Cores | Tensor Cores | Memory Bus Width (bit) | Memory Bandwidth (GB/s) |
| ------------------------- | -------------- | ---------- | ------------ | ---------------------- | ----------------------- |
| RTX 4090 Desktop (Ada)    | 24             | 16,384     | 512          | 384                    | ~1000                   |
| RTX 3090 Desktop (Ampere) | 24             | 10,496     | 328          | 384                    | 935.8                   |
| RTX 4060 Laptop (Ada)     | 8              | 3,072      | 96           | 128                    | 272                     |

:::warning[Low-spec Machines?]

We didn't bother including low-spec machines: TensorRT-LLM is meant for performance, and simply doesn't work on lower grade Nvidia GPUs, or computers without GPUs.

TensorRT-LLM provides blazing fast performance at the cost of [memory usage](https://nvidia.github.io/TensorRT-LLM/memory.html). This means that the performance improvements only show up in higher-range GPUs with larger VRAMs. 

We've found that [llama.cpp](https://github.com/ggerganov/llama.cpp) does an incredible job of democratizing inference to the [GPU Poor](https://www.semianalysis.com/p/google-gemini-eats-the-world-gemini#the-gpu-poor) with CPU-only or lower-range GPUs. Huge shout outs to the [llama.cpp maintainers](https://github.com/ggerganov/llama.cpp/graphs/contributors) and the [ggml.ai](https://ggml.ai/) team.   

:::

We chose the popular Mistral 7b model to run on both GGUF and TensorRT-LLM, picking comparable quantizations. 

#### llama.cpp Setup
- For llama.cpp, we used `Mistral-7b-q4_k_m`
- [ ] Fill in `ngl` params, GPU offload etc

#### TensorRT-LLM Setup
- For TensorRT-LLM, we used `Mistral-7b-int4 AWQ`
- We ran TensorRT-LLM with `free_gpu_memory_fraction` to test it with the lowest VRAM consumption (performance may be affected)
- Note: We picked AWQ for TensorRT-LLM as a handicap as AWQ supposedly sacrifices performance for quality

#### Experiment Setup
We ran the experiment using a standardized inference request in a sandboxed environment on the same machine:
- We ran tests 5 times for each inference engine, on a baremetal PC with no other applications open
- Each inference request was of `batch_size` 1 and `input_len` 2048, `output_len` 512 as a realistic test case
- CPU and Memory usage were obtained from.... Windows Task Manager 😱
- GPU usage was obtained from `nvtop`, `htop`, and `nvidia-smi`

## Results

Our biggest takeaway: TensorRT-LLM is faster than llama.cpp on 4090s and 3090s with larger VRAMs. However, on smaller GPUs (e.g. Laptop 4060 GPUs), 

|              | 4090 Desktop | 3090 Desktop | 4060 Laptop |
| ------------ | ------------ | ------------ | ----------- |
| TensorRT-LLM | ✅ 159t/s     | ✅ 140.27t/s  | ❌ 19t/s     |
| llama.cpp    | 101.3t/s     | 90t/s        | 22t/s       |

### RTX-4090 Desktop

:::info[Hardware Details]

- CPU: Intel 13th series
- GPU: NVIDIA GPU 4090 (Ampere - sm 86)
- RAM: 32GB
- OS: Windows 11 Pro on Proxmox

:::

Nvidia's RTX-4090 is their top-of-the-line consumer GPU, and retails for [approximately $2,000](https://www.amazon.com/rtx-4090/s?k=rtx+4090). 

#### Mistral-7b int4

| Metrics              | GGUF (using GPU) | TensorRT-LLM | Difference     |
| -------------------- | -------------------- | ------------ | -------------- |
| Throughput (token/s) | 101.3                | 159          | ✅ 57% faster   |
| VRAM Used (GB)       | 5.5                  | 6.3          | 🤔 14% more    |
| RAM Used (GB)        | 0.54                 | 0.42         | 🤯 20% less    |
| Disk Size (GB)       | 4.07                 | 3.66         | 🤯 10% smaller |


### RTX-3090 Desktop

:::info[Hardware Details]

- CPU: Intel 13th series
- GPU: NVIDIA GPU 3090 (Ampere - sm 86)
- RAM: 64GB
- OS: Windows

:::

#### Mistral-7b int4

| Metrics              | GGUF (using GPU) | TensorRT-LLM | Difference   |
| -------------------- | -------------------- | ------------ | ------------ |
| Throughput (token/s) | 90                   | ✅ 140.27     | ✅ 55% faster |
| VRAM Used (GB)       | 6.0                  | 6.8          | 🤔 13% more  |
| RAM Used (GB)        | 0.54                 | 0.42         | 🤯 22% less  |
| Disk Size (GB)       | 4.07                 | 3.66         | 🤯 10% less  |

### RTX-4060 Laptop

- [ ] Dan to re-run perf tests and fill in details

:::info[Hardware Details]

- Manufacturer: Acer Nitro 16 Phenix
- CPU: Ryzen 7000
- RAM: 16GB
- GPU: NVIDIA Laptop GPU 4060 (Ada)

:::

#### Mistral-7b int4

| Metrics              | GGUF (using the GPU) | TensorRT-LLM | Difference |
| -------------------- | -------------------- | ------------ | ---------- |
| Throughput (token/s) | 22                   | ❌ 19         |            |
| VRAM Used (GB)       | 2.1                  | 7.7          |            |
| RAM Used (GB)        | 0.3                  | 13.5         |            |
| Disk Size (GB)       | 4.07                 | 4.07         |            |