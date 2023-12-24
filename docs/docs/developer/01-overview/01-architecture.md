---
title: Architecture
slug: /developer/architecture
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

:::warning

This page is still under construction, and should be read as a scratchpad

:::

## Overview

- Jan has a modular architecture and is largely built on top of its own modules.
- Jan uses a local [file-based approach](/developer/file-based) for data persistence.
- Jan provides an Electron-based [Desktop UI](https://github.com/janhq/jan).
- Jan provides an embeddable inference engine, written in C++, called [Nitro](https://nitro.jan.ai/docs/).

## Extensions

Jan has an Extensions API inspired by VSCode. In fact, most of Jan's core services are built as extensions.

Jan supports the following OpenAI compatible extensions:

| Jan Module | Description   | API Docs                                      |
| ---------- | ------------- | --------------------------------------------- |
| Chat       | Inference     | [/chats](/api-reference/#tag/Chat-Completion) |
| Models     | Models        | [/models](/api-reference/#tag/Models)         |
| Assistants | Apps          | [/assistants](/api-reference/#tag/Assistants) |
| Threads    | Conversations | [/threads](/api-reference/#tag/Threads)       |
| Messages   | Messages      | [/messages](/api-reference/#tag/Messages)     |

<!-- TODO: link npm modules -->

## Modules

Modules are low level, system services. It is similar to OS kernel modules. Modules provide abstractions to basic, device level functionality like working with the filesystem, device system, databases, AI inference engines, etc.

Jan follows the [dependency inversion principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle) such that `modules` expose the interfaces that `extensions` can then implement.
