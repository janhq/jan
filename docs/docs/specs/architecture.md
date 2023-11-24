---
title: Architecture
---

:::warning

This page is still under construction, and should be read as a scratchpad

:::

## Overview

- Jan built a modular infrastructure on top of Electron, in order to support extensions and AI functionality.
- Jan is largely built on top of its own modules.
- Jan uses a local [file-based approach](/specs/file-based) for data persistence.

## Modules

Modules are low level, system services. It is similar to OS kernel modules, in that modules provide abstractions to functionality like the filesystem, device system, databases, AI inference engines, etc.

## Pluggable Modules

Jan exports modules that mirror OpenAI’s, exposing similar APIs and objects:

- Modules are modular, atomic implementations of a single OpenAI-compatible endpoint
- Modules can be swapped out for alternate implementations
  - The default `messages` module persists messages in thread-specific `.json`
  - `messages-postgresql` uses Postgres for production-grade cloud-native environments

| Jan Module | Description   | API Docs                     |
| ---------- | ------------- | ---------------------------- |
| Chat       | Inference     | [/chat](/api/chat)           |
| Models     | Models        | [/model](/api/model)         |
| Assistants | Apps          | [/assistant](/api/assistant) |
| Threads    | Conversations | [/thread](/api/thread)       |
| Messages   | Messages      | [/message](/api/message)     |

<!-- TODO: link npm modules -->

## Extensions

Extensions are feature level services that include both UI and logic implementation.

<!-- TODO[@linh]: add all of @linh's specs here -->
