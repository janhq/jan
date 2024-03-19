---
title: Installation and Prerequisites
slug: /developer/prereq
description: Guide to install and setup Jan for development.
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
    installation,
    prerequisites,
    developer setup,
  ]
---

<head>
  <title>Jan AI Installation and Setup Guide - Developer Prerequisites</title>
  <meta charSet="utf-8" />
  <meta name="description" content="Comprehensive guide to installing and setting up Jan for development. Covers hardware, system requirements, and step-by-step instructions for developers." />
  <meta name="keywords" content="Jan AI, Jan, ChatGPT alternative, local AI, private AI, conversational AI, no-subscription fee, large language model, installation, prerequisites, developer setup" />
  <meta name="twitter:card" content="summary" />
  <link rel="canonical" href="https://jan.ai/developer/prereq/" />
  <meta property="og:title" content="Jan AI Installation and Setup Guide - Developer Prerequisites" />
  <meta property="og:description" content="Comprehensive guide to installing and setting up Jan for development. Covers hardware, system requirements, and step-by-step instructions for developers." />
  <meta property="og:url" content="https://jan.ai/developer/prereq/" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://jan.ai/img/og-image.png" />
</head>

## Requirements

### Hardware Requirements

Ensure your system meets the following specifications to guarantee a smooth development experience:

- Hardware Requirements

### System Requirements

Make sure your operating system meets the specific requirements for Jan development:

- [Windows](../../install/windows/#system-requirements)
- [MacOS](../../install/mac/#system-requirements)
- [Linux](../../install/linux/#system-requirements)

## Prerequisites

- [Node.js](https://nodejs.org/en/) (version 20.0.0 or higher)
- [yarn](https://yarnpkg.com/) (version 1.22.0 or higher)
- [make](https://www.gnu.org/software/make/) (version 3.81 or higher)

## Instructions

1. **Clone the Repository:**

```bash
git clone https://github.com/janhq/jan
cd jan
git checkout -b DESIRED_BRANCH
```

2. **Install Dependencies**

```bash
yarn install
```

3. **Run Development and Use Jan Desktop**

```bash
make dev
```

This command starts the development server and opens the Jan Desktop app.

## For Production Build

```bash
# Do steps 1 and 2 in the previous section
# Build the app
make build
```

This will build the app MacOS (M1/M2/M3) for production (with code signing already done) and place the result in `/electron/dist` folder.

## Troubleshooting

If you run into any issues due to a broken build, please check the [Stuck on a Broken Build](../../troubleshooting/stuck-on-broken-build) guide.
