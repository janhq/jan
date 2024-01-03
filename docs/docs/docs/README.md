---
title: Overview
slug: /docs
---

The following low-level docs are aimed at core contributors and cover how to contribute to the Core SDK.

:::tip
If you are interested to **build on top of the SDK**, like creating assistants or adding app level extensions, please refer to [developer docs](/developer) instead.
:::

## Core SDK

At its Core, Jan is a cross-platform, local-first and AI native framework that can be used to build anything. In fact, current features are all implemented as 3rd party extensions on top of this Core SDK.

Ultimately, we aim for a VSCode or Obsidian like framework that allows devs to build and customize complex AI applications for their specific needs, in less than 15 minutes.

### Cross Platform

Jan follows [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) to the best of our ability. Though leaky abstractions remain (we're a fast moving, open source codebase), we do our best to build an SDK that allows devs to **build once, deploy everywhere.**

Currently, Jan supports:

- `Node Native Runtime`, good for server side apps
- `Electron Chromium`, good for Desktop Native apps
- `Capacitor`, good for Mobile apps (planned, not built yet)
- `Python Runtime`, good for MLOps workflows (planned, not built yet)

Currently, Jan works across:

- Mac Intel & Silicon
- Windows
- Ubuntu
- Nvidia GPUs

Read more:

- [Code Entrypoint](https://github.com/janhq/jan/tree/main/core)
- [Dependency Inversion](https://en.wikipedia.org/wiki/Dependency_inversion_principle)

### Local First

Jan's data persistence happens on the user's local filesystem.

We implemented abstractions on top of `fs` and other core modules in an opinionated way, s.t. user data is saved in a folder-based framework that lets users easily package, export, and manage their data.

Read more:

- [Folder-based fs wrapper](https://github.com/janhq/jan/blob/main/core/src/fs.ts)
- [Piping Node modules across infrastructures](https://github.com/janhq/jan/tree/main/core/src/node)

### AI Native

All software applications can be natively supercharged with an embedded AI server and AI abstractions.

Including:

- OpenAI Compatible AI [types](https://github.com/janhq/jan/tree/main/core/src/types) and [core extensions](https://github.com/janhq/jan/tree/main/core/src/extensions) to support common functionality like making an inference call.
- A lightweight, embedded C++ [inference engine](https://github.com/janhq/jan/tree/main/extensions/inference-nitro-extension) that's immediately callable from code.

- [Code Entrypoint](https://github.com/janhq/jan/tree/main/core/src/api)

## Fun Project Ideas

Beyond the current Jan client and UX, the Core SDK can be used to build many other AI-powered and privacy preserving applications.

- `Game engine`: For AI enabled character games, procedural generation games
- `Health app`: For a personal healthcare app that improves habits
- Got ideas? Make a PR into this docs page!

If you are interested to tackle these issues, or have suggestions for integrations and other OSS tools we can use, please hit us up in [Discord](https://discord.gg/5rQ2zTv3be).
