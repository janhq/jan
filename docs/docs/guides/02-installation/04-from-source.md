---
title: From Source
slug: /install/from-source
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

# Installing Jan from Source

## Installation

### Pre-requisites

Before proceeding with the installation of Jan from source, ensure that the following software versions are installed on your system:

- Node.js version 20.0.0 or higher
- Yarn version 1.22.0 or higher

### Instructions

:::note

This instruction is tested on MacOS only.

:::

1. Clone the Jan repository from GitHub

```bash
git clone https://github.com/janhq/jan
git checkout DESIRED_BRANCH
cd jan
```

2. Install the required dependencies using Yarn

```bash
yarn install

# Build core module
yarn build:core

# Packing base plugins
yarn build:plugins

# Packing uikit
yarn build:uikit
```

3. Run development and using Jan

```bash
yarn dev
```

This will start the development server and open the desktop app. During this step, you may encounter notifications about installing base plugins. Simply click `OK` and `Next` to continue.

#### For production build

Build the app for macOS M1/M2 for production and place the result in the dist folder

```bash
# Do step 1 and 2 in the previous section
git clone https://github.com/janhq/jan
cd jan
yarn install

# Build core module
yarn build:core

# Package base plugins
yarn build:plugins

# Packing uikit
yarn build:uikit

# Build the app
yarn build
```

This completes the installation process for Jan from source. The production-ready app for macOS can be found in the dist folder.
