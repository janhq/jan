---
title: Installation and Prerequisites
slug: /developer/install-and-prerequisites
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
    installation,
    prerequisites,
    developer setup,
  ]
---

## Requirements

- [Hardware Requirements](../../guides/02-installation/06-hardware.md)

- System Requirements:
  - [Windows](../../install/windows/#system-requirements)
  - [MacOS](../../install/mac/#system-requirements)
  - [Linux](../../install/linux/#system-requirements)

## Prerequisites

- [Node.js](https://nodejs.org/en/) (version 20.0.0 or higher)
- [yarn](https://yarnpkg.com/) (version 1.22.0 or higher)
- [make](https://www.gnu.org/software/make/) (version 3.81 or higher)

## Instructions

1. Clone the repository and install dependencies

```bash
git clone https://github.com/janhq/jan
cd jan
git checkout -b DESIRED_BRANCH
```

2. Install dependencies

```bash
yarn install
```

3. Run development and use Jan Desktop

```bash
make dev
```

This will start the development server and open the Jan Desktop app.

## For Production Build

```bash
# Do steps 1 and 2 in the previous section
# Build the app
make build
```

This will build the app MacOS (M1/M2/M3) for production (with code signing already done) and put the result in `dist` folder.
