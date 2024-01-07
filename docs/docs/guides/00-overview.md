---
title: Overview
slug: /guides
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

The following docs are aimed at end users who want to troubleshoot or learn how to use the **Jan Desktop** application better.

:::tip
If you are interested to build extensions, please refer to [developer docs](/developer) instead (WIP).

If you are interested to contribute to the underlying framework, please refer to [framework docs](/docs) instead.
:::

## Jan Desktop

The desktop client is a ChatGPT alternative that runs on your own computer, with a [local API server](/guides/using-server).

## Features

- Compatible with [open-source models](/guides/using-models) (GGUF via [llama.cpp](https://github.com/ggerganov/llama.cpp), TensorRT via [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM), and [remote APIs](https://platform.openai.com/docs/api-reference))
- Compatible with most OSes: [Windows](/install/windows/), [Mac](/install/mac), [Linux](/install/linux), with GPU acceleration through [llama.cpp](https://github.com/ggerganov/llama.cpp)
- Stores data in [open file formats](/developer/file-based)
- Local API [server mode](/guides/using-server)
- Customizable via [extensions](/developer/build-extension)
- And more in the [roadmap](https://github.com/orgs/janhq/projects/5/views/16). Join us on [Discord](https://discord.gg/5rQ2zTv3be) and tell us what you want to see!

## Why Jan?

We believe in the need for an open source AI ecosystem.

We're focused on building infra, tooling and [custom models](https://huggingface.co/janhq) to allow open source AIs to compete on a level playing field with proprietary offerings.

Read more about our mission and culture [here](/about).

#### 💻 Own your AI

Jan runs 100% on your own machine, predictably, privately and offline. No one else can see your conversations, not even us.

#### 🏗️ Extensions

Jan ships with a local-first, AI-native, and cross platform [extensions framework](/developer/build-extension). Developers can extend and customize everything from functionality to UI to branding. In fact, Jan's current main features are actually built as extensions on top of this framework.

#### 🗂️ Open File Formats

Jan stores data in your [local filesystem](/developer/file-based). Your data never leaves your computer. You are free to delete, export, migrate your data, even to a different platform.

#### 🌍 Open Source

Both Jan and [Nitro](https://nitro.jan.ai), our lightweight inference engine, are licensed via the open source [AGPLv3 license](https://github.com/janhq/jan/blob/main/LICENSE).
