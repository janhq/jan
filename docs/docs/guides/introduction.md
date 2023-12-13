---
title: Introduction
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

Jan is a ChatGPT-alternative that runs on your own computer, with a [local API server](/api-reference/).

Jan uses [open-source AI models](/docs/models), stores data in [open file formats](/specs/data-structures), is highly customizable via [extensions](/docs/extensions).

Jan believes in the need for an open source AI ecosystem. We aim to build infra and tooling to allow open source AIs to compete on a level playing field with proprietary offerings.

## Why Jan?

#### 💻 Own your AI

Jan runs 100% on your own machine, [predictably](https://www.reddit.com/r/LocalLLaMA/comments/17mghqr/comment/k7ksti6/?utm_source=share&utm_medium=web2x&context=3), privately and even offline. No one else can see your conversations, not even us.

#### 🏗️ Extensions

Jan ships with a powerful [extension framework](/docs/extensions), which allows developers to extend and customize Jan's functionality. In fact, most core modules of Jan are [built as extensions](/specs/architecture) and use the same extensions API.

#### 🗂️ Open File Formats

Jan stores data in a [local folder of non-proprietary files](/specs/data-structures). You're never locked-in and can do what you want with your data with extensions, or even a different app.

#### 🌍 Open Source

Both Jan and [Nitro](https://nitro.jan.ai), our lightweight inference engine, are licensed via the open source [AGPLv3 license](https://github.com/janhq/jan/blob/main/LICENSE).

<!-- ## Design Principles -->

<!-- OpenAI meets VSCode meets Obsidian.

Minimalism: https://docusaurus.io/docs#design-principles. Not having abstractions is better than having the wrong abstractions. Assistants as code. Only including features that are absolutely necessary in the Jan API.

File-based: User should be able to look at a Jan directory and intuit how it works. Transparency. Editing things via a text editor, vs. needing a database tool for SQLite.

Participatory: https://www.getlago.com/blog/the-5-reasons-why-we-chose-open-source -->
