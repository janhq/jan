---
title: Analytics
slug: /how-we-work/analytics
description: Jan's Analytics philosophy and implementation
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
    analytics,
  ]
---

Adhering to Jan's privacy preserving philosophy, our analytics philosophy is to get "barely-enough-to-function'.

#### What is tracked

1. By default, Github tracks downloads and device metadata for all public GitHub repositories. This helps us troubleshoot & ensure cross-platform support.
2. We use [Umami](https://umami.is/) to collect, analyze, and understand application data while maintaining visitor privacy and data ownership. We are using the Umami Cloud in Europe to ensure GDPR compliance. Please see [Umami Privacy Policy](https://umami.is/privacy) for more details.
3. We use Umami to track a single `app.opened` event without additional user metadata, in order to understand retention. In addition, we track `app.version` to understand app version usage.
4. Additionally, we plan to enable a `Settings` feature for users to turn off all tracking.
