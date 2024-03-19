---
title: Overview
slug: /developer
description: Jan Docs | Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
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

<head>
  <title>Jan AI Developer Documentation - Building Extensions and SDK Overview</title>
  <meta charSet="utf-8" />
  <meta name="description" content="Guide for developers on building extensions on top of the Jan Framework. Learn about Jan's extensible framework for AI applications, available on all platforms." />
  <meta name="keywords" content="Jan AI, Jan, ChatGPT alternative, local AI, private AI, conversational AI, no-subscription fee, large language model, extensible framework, SDK, building extensions" />
  <meta name="twitter:card" content="summary" />
  <link rel="canonical" href="https://jan.ai/developer/" />
  <meta property="og:title" content="Jan AI Developer Documentation - Building Extensions and SDK Overview" />
  <meta property="og:description" content="Guide for developers on building extensions on top of the Jan Framework. Learn about Jan's extensible framework for AI applications, available on all platforms." />
  <meta property="og:url" content="https://jan.ai/developer/" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://jan.ai/img/og-image.svg" />
</head>

The following docs are aimed at developers who want to build extensions on top of the Jan Framework.

:::tip
If you are interested to **contribute to the framework's Core SDK itself**, like adding new drivers, runtimes, and infrastructure level support, please refer to [framework docs](/developer/framework) instead.
:::

## Extensions

Jan an **extensible framework** (like VSCode or Obsidian) that lets you build, customize and run AI applications everywhere, with an emphasis on local first.

Extensions are automatically available across Mac, Windows, Linux Desktops.

Extensions can also be made available in local API server-mode, which can be deployed on any VM.

### Building Extensions

This framework is packaged and regularly published as an SDK through [npm](https://www.npmjs.com/org/janhq) and [pip](https://pypi.org/).

The framework provides built-in support for the following:

- Native OS integrations with Electron and Chromium
- Native server integrations with Nodejs
- Native mobile integrations with Capacitor (coming soon)

:::tip
Build once, deploy everywhere
:::

## Jan in Action

The [Jan Desktop client](https://github.com/janhq/jan/releases) is built with Jan SDK. This means you can customize any part of the application from the branding to the features, and truly make it your own.

[Gif: show desktop & server side by side]
