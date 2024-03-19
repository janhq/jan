---
title: Analytics
---

<head>
    <title>Analytics</title>
    <meta name="description" content="Learn about the analytics philosophy for Jan, focusing on privacy preservation and collecting minimal data for essential functionality.">
    <meta name="keywords" content="analytics, privacy-preserving, Umami, data collection, GDPR compliance">
    <meta property="og:title" content="Analytics">
    <meta property="og:description" content="Learn about the analytics philosophy for Jan, focusing on privacy preservation and collecting minimal data for essential functionality.">
    <meta property="og:url" content="https://yourwebsite.com/analytics">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Analytics">
    <meta name="twitter:description" content="Learn about the analytics philosophy for Jan, focusing on privacy preservation and collecting minimal data for essential functionality.">
</head>

Adhering to Jan's privacy preserving philosophy, our analytics philosophy is to get "barely-enough-to-function'.

#### What is tracked

1. By default, Github tracks downloads and device metadata for all public GitHub repositories. This helps us troubleshoot & ensure cross-platform support.
2. We use [Umami](https://umami.is/) to collect, analyze, and understand application data while maintaining visitor privacy and data ownership. We are using the Umami Cloud in Europe to ensure GDPR compliance. Please see [Umami Privacy Policy](https://umami.is/privacy) for more details.
3. We use Umami to track a single `app.opened` event without additional user metadata, in order to understand retention. In addition, we track `app.version` to understand app version usage.
4. Additionally, we plan to enable a `Settings` feature for users to turn off all tracking.
