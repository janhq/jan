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

## Requirements

### Hardware Requirements

Ensure your system meets the following specifications to guarantee a smooth development experience:

- [Hardware Requirements](../../guides/02-installation/06-hardware.md)

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
