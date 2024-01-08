---
title: Overview
slug: /docs
---

The following low-level docs are aimed at core contributors.

We cover how to contribute to the core framework (aka the `Core SDK`).

:::tip
If you are interested to **build on top of the framework**, like creating assistants or adding app level extensions, please refer to [developer docs](/developer) instead.
:::

## Jan Framework

At its core, Jan is a **cross-platform, local-first and AI native framework** that can be used to build anything.

### Extensions

Ultimately, we aim for a `VSCode` or `Obsidian` like SDK that allows **devs to build and customize complex and ethical AI applications for any use case**, in less than 30 minutes.

In fact, the current Jan [Desktop Client](https://jan.ai/) is actually just a specific set of extensions & integrations built on top of this framework.

![Desktop is Extensions](./assets/ExtensionCallouts.png)

:::tip
We encourage devs to fork, customize, and open source your improvements for the greater community.
:::

### Cross Platform

Jan follows [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) to the best of our ability. Though leaky abstractions remain (we're a fast moving, open source codebase), we do our best to build an SDK that allows devs to **build once, deploy everywhere.**

![Clean Architecture](./assets/CleanArchitecture.jpg)

**Supported Runtimes:**

- `Node Native Runtime`, good for server side apps
- `Electron Chromium`, good for Desktop Native apps
- `Capacitor`, good for Mobile apps (planned, not built yet)
- `Python Runtime`, good for MLOps workflows (planned, not built yet)

**Supported OS & Architectures:**

- Mac Intel & Silicon
- Windows
- Linux (through AppImage)
- Nvidia GPUs
- AMD ROCm (coming soon)

Read more:

- [Code Entrypoint](https://github.com/janhq/jan/tree/main/core)
- [Dependency Inversion](https://en.wikipedia.org/wiki/Dependency_inversion_principle)

### Local First

Jan's data persistence happens on the user's local filesystem.

We implemented abstractions on top of `fs` and other core modules in an opinionated way, s.t. user data is saved in a folder-based framework that lets users easily package, export, and manage their data.

Future endeavors on this front include cross device syncing, multi user experience, and more.

Long term, we want to integrate with folks working on [CRDTs](https://www.inkandswitch.com/local-first/), e.g. [Socket Runtime](https://www.theregister.com/2023/04/11/socket_runtime/) to deeply enable local-first software.

Read more:

- [Folder-based wrappers entrypoint](https://github.com/janhq/jan/blob/main/core/src/fs.ts)
- [Piping Node modules across infrastructures](https://github.com/janhq/jan/tree/main/core/src/node)

:::caution
Our local first approach at the moment needs a lot of work. Please don't hesitate to refactor as you make your way through the codebase.
:::

### AI Native

We believe all software applications can be natively supercharged with AI primitives and embedded AI servers.

Including:

- OpenAI Compatible AI [types](https://github.com/janhq/jan/tree/main/core/src/types) and [core extensions](https://github.com/janhq/jan/tree/main/core/src/extensions) to support common functionality like making an inference call.
- Multiple inference engines through [extensions, integrations & wrappers](https://github.com/janhq/jan/tree/main/extensions/inference-nitro-extension) _On this, we'd like to appreciate the folks at [llamacpp](https://github.com/ggerganov/llama.cpp) and [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) for. To which we'll continue to make commits & fixes back upstream._

- [Code Entrypoint](https://github.com/janhq/jan/tree/main/core/src/api)

## Fun Project Ideas

Beyond the current Jan client and UX, the Core SDK can be used to build many other AI-powered and privacy preserving applications.

- `Game engine`: For AI enabled character games, procedural generation games
- `Health app`: For a personal healthcare app that improves habits
- Got ideas? Make a PR into this docs page!

If you are interested to tackle these issues, or have suggestions for integrations and other OSS tools we can use, please hit us up in [Discord](https://discord.gg/5rQ2zTv3be).

:::caution
Our open source license is copy left, which means we encourage forks to stay open source, and allow core contributors to merge things upstream.
:::
