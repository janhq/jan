---
title: Analytics
---

Adhering to Jan's privacy preserving philosophy, our analytics philosophy is to get "barely-enough-to-function".

#### What is tracked

1. By default, Github tracks downloads and device metadata for all public Github repos. This helps us troubleshoot & ensure cross platform support.
1. We use [Umami](https://umami.is/), an analytics tool that ensures visitor privacy and data ownership, to track a single `app.opened` event. We do not get additional user metadata. This is done to understand retention.
1. Additionally, we plan to enable a `Settings` feature for users to turn off all tracking.
