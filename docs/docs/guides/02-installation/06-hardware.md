---
title: Hardware Requirements
slug: /guides/install/hardware
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
  ]
---

Jan is designed to be lightweight and able to run Large Language Models (LLMs) out-of-the-box.

The current download size is less than 150 MB and has a disk space of ~300 MB.

To ensure optimal performance, please see the following system requirements:

## Disk Space

- Minimum requirement
  - At least 5 GB of free disk space is required to accommodate the download, storage, and management of open-source LLM models.
- Recommended
  - For an optimal experience and to run most available open-source LLM models on Jan, it is recommended to have 10 GB of free disk space.

## RAM and GPU VRAM

The amount of RAM on your system plays a crucial role in determining the size and complexity of LLM models you can effectively run. Jan can be utilized on traditional computers where RAM is a key resource. For enhanced performance, Jan also supports GPU acceleration, utilizing the VRAM of your graphics card.

## Best Models for your V/RAM

The RAM and GPU VRAM requirements are dependent on the size and complexity of the LLM models you intend to run. The following are some general guidelines to help you determine the amount of RAM or VRAM you need to run LLM models on Jan

- `8 GB of RAM`: Suitable for running smaller models like 3B models or quantized 7B models
- `16 GB of RAM (recommended)`: This is considered the "minimum usable models" threshold, particularly for 7B models (e.g Mistral 7B, etc)
- `Beyond 16GB of RAM`: Required for handling larger and more sophisticated model, such as 70B models.

## Architecture

Jan is designed to run on multiple architectures, versatility and widespread usability. The supported architectures include:

### CPU Support

- `x86`: Jan is well-suited for systems with x86 architecture, which is commonly found in traditional desktops and laptops. It ensures smooth performance on a variety of devices using x86 processors.
- `ARM`: Jan is optimized to run efficiently on ARM-based systems, extending compatibility to a broad range of devices using ARM processors.

### GPU Support

- `NVIDIA`
- `AMD`
- `ARM64 Mac`
