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

TODO: pair this down. just quicklinks.

Jan SDK is an **extensible framework** that lets you build and run AI applications everywhere, with an emphasis on local first.

It is available across Mac, Windows, Linux Desktops. It is also available as a headless server that can be deployed into any on-prem or cloud environments.

This framework is packaged and regularly published as an SDK through [npm](https://www.npmjs.com/org/janhq) and [pip](https://pypi.org/).

The SDK provides built-in support for the following:

- Native OS integrations with Electron and Chromium
- Native server integrations with Nodejs
- Native mobile integrations with Capacitor (coming soon)

:::tip
The [Jan Desktop client](https://github.com/janhq/jan/releases) is built with Jan SDK. This means you can customize any part of the application from the branding to the features, and truly make it your own.
:::

## Jan in Action

[Gif: show desktop & server side by side]

## Extensions

You can extend the application UI & use cases through extensions.

Jan's core devs and growing developer community are constantly adding new extensions that bring feature level improvements and 3rd party integrations.

Read more about [application extensions](/docs/extension-capabilities/application).

## Core SDK

You can extend how Jan natively runs on your infrastructure, including making framework or driver level changes, through modifying the `core SDK`. For example, you can create inline OS commands or even integrate Jan with your IoT.

Core Extension improvements can be packaged back into the core SDK and distributed to other extension developers.

Read more about [core extensions](/docs/extension-capabilities/core/)

## UI Kit

Jan ships with an AI friendly UI kit that can be used with Jan SDK or any other Javascript project.

Read more about our [ui kit](/docs/ui-kit)
