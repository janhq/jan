---
title: TensorRT-LLM
slug: /guides/providers/tensorrt-llm
keywords:
  [
    Jan,
    Rethink the Computer,
    local AI,
    privacy focus,
    free and open source,
    private and offline,
    conversational AI,
    no-subscription fee,
    large language models,
    TensorRT-LLM Extension,
    TensorRT,
    tensorRT,
    extension,
  ]
---

:::info

TensorRT-LLM support was launched in 0.4.9, and should be regarded as an Experimental feature.

- Only Windows is supported for now.
- Please report bugs in our Discord's [#tensorrt-llm](https://discord.com/channels/1107178041848909847/1201832734704795688) channel.

:::

Jan supports [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) as an alternate Inference Engine, for users who have Nvidia GPUs with large VRAM. TensorRT-LLM allows for blazing fast inference, but requires Nvidia GPUs with [larger VRAM](https://nvidia.github.io/TensorRT-LLM/memory.html).

## What is TensorRT-LLM?

[TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) is an hardware-optimized LLM inference engine for Nvidia GPUs, that compiles models to run extremely fast on Nvidia GPUs.

- Mainly used on Nvidia's Datacenter-grade GPUs like the H100s [to produce 10,000 tok/s](https://nvidia.github.io/TensorRT-LLM/blogs/H100vsA100.html).
- Can be used on Nvidia's workstation (e.g. [A6000](https://www.nvidia.com/en-us/design-visualization/rtx-6000/)) and consumer-grade GPUs (e.g. [RTX 4090](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/))

:::tip[Benefits]

- Our performance testing shows 20-40% faster token/s speeds on consumer-grade GPUs
- On datacenter-grade GPUs, TensorRT-LLM can go up to 10,000 tokens/s
- TensorRT-LLM is a relatively new library, that was [released in Sept 2023](https://github.com/NVIDIA/TensorRT-LLM/graphs/contributors). We anticipate performance and resource utilization improvements in the future.

:::

:::warning[Caveats]

- TensorRT-LLM requires models to be compiled into GPU and OS-specific "Model Engines" (vs. GGUF's "convert once, run anywhere" approach)
- TensorRT-LLM Model Engines tend to utilize larger amount of VRAM and RAM in exchange for performance
- This usually means only people with top-of-the-line Nvidia GPUs can use TensorRT-LLM

:::

## Requirements

### Hardware

- Windows PC
- Nvidia GPU(s): Ada or Ampere series (i.e. RTX 4000s & 3000s). More will be supported soon.
- 3GB+ of disk space to download TRT-LLM artifacts and a Nitro binary

**Compatible GPUs**

| Architecture | Supported? | Consumer-grade | Workstation-grade |
| ------------ | ---------- | -------------- | ----------------- |
| Ada          | ✅         | 4050 and above | RTX A2000 Ada     |
| Ampere       | ✅         | 3050 and above | A100              |
| Turing       | ❌         | Not Supported  | Not Supported     |

:::info

Please ping us in Discord's [#tensorrt-llm](https://discord.com/channels/1107178041848909847/1201832734704795688) channel if you would like Turing support.

:::

### Software

- Jan v0.4.9+ or Jan v0.4.8-321+ (nightly)
- [Nvidia Driver v535+](https://jan.ai/guides/common-error/not-using-gpu/#1-ensure-gpu-mode-requirements)
- [CUDA Toolkit v12.2+](https://jan.ai/guides/common-error/not-using-gpu/#1-ensure-gpu-mode-requirements)

## Getting Started

### Install TensorRT-Extension

1. Go to Settings > Extensions
2. Install the TensorRT-LLM Extension

:::info
You can check if files have been correctly downloaded:

```sh
ls ~\jan\extensions\@janhq\tensorrt-llm-extension\dist\bin
# Your Extension Folder should now include `nitro.exe`, among other `.dll` files needed to run TRT-LLM
```

:::

### Download a TensorRT-LLM Model

Jan's Hub has a few pre-compiled TensorRT-LLM models that you can download, which have a `TensorRT-LLM` label

- We automatically download the TensorRT-LLM Model Engine for your GPU architecture
- We have made a few 1.1b models available that can run even on Laptop GPUs with 8gb VRAM

| Model               | OS      | Ada (40XX) | Ampere (30XX) | Description                                         |
| ------------------- | ------- | ---------- | ------------- | --------------------------------------------------- |
| Llamacorn 1.1b      | Windows | ✅         | ✅            | TinyLlama-1.1b, fine-tuned for usability            |
| TinyJensen 1.1b     | Windows | ✅         | ✅            | TinyLlama-1.1b, fine-tuned on Jensen Huang speeches |
| Mistral Instruct 7b | Windows | ✅         | ✅            | Mistral                                             |

### Importing Pre-built Models

You can import a pre-built model, by creating a new folder in Jan's `/models` directory that includes:

- TensorRT-LLM Engine files (e.g. `tokenizer`, `.engine`, etc)
- `model.json` that registers these files, and specifies `engine` as `nitro-tensorrt-llm`

:::note[Sample model.json]

Note the `engine` is `nitro-tensorrt-llm`: this won't work without it!

```js
{
  "sources": [
    {
      "filename": "config.json",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/config.json"
    },
    {
      "filename": "mistral_float16_tp1_rank0.engine",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/mistral_float16_tp1_rank0.engine"
    },
    {
      "filename": "tokenizer.model",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/tokenizer.model"
    },
    {
      "filename": "special_tokens_map.json",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/special_tokens_map.json"
    },
    {
      "filename": "tokenizer.json",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/tokenizer.json"
    },
    {
      "filename": "tokenizer_config.json",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/tokenizer_config.json"
    },
    {
      "filename": "model.cache",
      "url": "https://delta.jan.ai/dist/models/<gpuarch>/<os>/tensorrt-llm-v0.7.1/TinyJensen-1.1B-Chat-fp16/model.cache"
    }
  ],
  "id": "tinyjensen-1.1b-chat-fp16",
  "object": "model",
  "name": "TinyJensen 1.1B Chat FP16",
  "version": "1.0",
  "description": "Do you want to chat with Jensen Huan? Here you are",
  "format": "TensorRT-LLM",
  "settings": {
    "ctx_len": 2048,
    "text_model": false
  },
  "parameters": {
    "max_tokens": 4096
  },
  "metadata": {
    "author": "LLama",
    "tags": [
      "TensorRT-LLM",
      "1B",
      "Finetuned"
    ],
    "size": 2151000000
  },
  "engine": "nitro-tensorrt-llm"
}
```

:::

### Using a TensorRT-LLM Model

You can just select and use a TensorRT-LLM model from Jan's Thread interface.

- Jan will automatically start the TensorRT-LLM model engine in the background
- You may encounter a pop-up from Windows Security, asking for Nitro to allow public and private network access

:::info[Why does Nitro need network access?]

- This is because Jan runs TensorRT-LLM using the [Nitro Server](https://github.com/janhq/nitro-tensorrt-llm/)
- Jan makes network calls to the Nitro server running on your computer on a separate port

:::

### Configure Settings

:::note
coming soon
:::

## Troubleshooting

## Extension Details

Jan's TensorRT-LLM Extension is built on top of the open source [Nitro TensorRT-LLM Server](https://github.com/janhq/nitro-tensorrt-llm), a C++ inference server on top of TensorRT-LLM that provides an OpenAI-compatible API.

### Manual Build

To manually build the artifacts needed to run the server and TensorRT-LLM, you can reference the source code. [Read here](https://github.com/janhq/nitro-tensorrt-llm?tab=readme-ov-file#quickstart).

### Uninstall Extension

1. Quit the app
2. Go to Settings > Extensions
3. Delete the entire Extensions folder.
4. Reopen the app, only the default extensions should be restored.

## Build your own TensorRT models

:::info
coming soon
:::
