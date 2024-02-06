---
title: DevRel
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
slug: /engineering/devrel
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
    developer relations,
  ]
---

The primary purpose of this documentation is to provide a starting point for developers and contributors to understand the overview of the `janhq/jan` repository. This includes the project structure, development process and contribution guidelines.

## Project Structure

The `janhq/jan` repository is organized to facilitate the development and maintainance. Here is an overview of the key directories and their purpose:

- `core`: This module includes functions for communicating with core APIs, registering app extensions, and exporting type definitions.
- `docs`: This directory contains the source code for the Jan website and documentation. Currently, it is built using Docusaurus.
- `electron`: This directory contains the source code for building the Jan app using Electron.
- `extensions`: This folder contains the source code for the extensions that are included as default in the Jan app.
- `models`: This directory contains the source code for the models that are included as default in the Jan app.
- `server`: This directory contains the source code for the Jan server.
- `uikit`: This directory contains the source code for the Jan UI kit.
- `web`: This directoty contains the source code for the Jan app.

## Development Process
