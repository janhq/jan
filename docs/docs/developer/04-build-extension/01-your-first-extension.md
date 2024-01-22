---
title: Your First Extension
slug: /developer/build-extension/your-first-extension/
description: A quick start on how to build your first extension
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
    quick start,
    build extension,
  ]
---

:::caution
This is currently under development.
:::

In this guide, we'll walk you through the process of building your first extension and integrating it into Jan.

## Steps to Create Your First Extension

To create your own extension, you can follow the steps below:

1. Click the **Use this template** button at the top of the [extension-template repository](https://github.com/janhq/extension-template).
2. Select **Create a new repository**.
3. Choose an owner and name for your new repository.
4. Click **Create repository**.
5. Clone your new repository to your local machine.

## Initial Setup

After you have cloned the repository to your local machine or codespace, you will need to perform some initial setup steps before you can develop your extension.

:::info

You will need to have a reasonably modern version of [Node.js](https://nodejs.org) handy. If you are using a version manager like [`nodenv`](https://github.com/nodenv/nodenv) or [`nvm`](https://github.com/nvm-sh/nvm), you can run `nodenv install` in the root of your repository to install the version specified in
[`package.json`](https://github.com/janhq/extension-template/blob/main/package.json). Otherwise, 20.x or later should work!

:::

1. :hammer_and_wrench: Install the dependencies

```bash
npm install
```

2. :building_construction: Package the TypeScript for distribution

```bash
npm run bundle
```

3. :white_check_mark: Check your artifact

There will be a `.tgz` file in your extension directory now. This is the file you will need to import into Jan. You can import this file into Jan by following the instructions in the [Import Extension](https://jan.ai/guides/using-extensions/import-extensions/) guide.

## Update the Extension Metadata

The [`package.json`](https://github.com/janhq/extension-template/blob/main/package.json) file defines metadata about your extension, such as extension name, main entry, description and version.

When you copy this repository, update `package.json` with the name, and description for your extension.

## Update the Extension Code

The [`src/`](https://github.com/janhq/extension-template/tree/main/src) directory is the heart of your extension! This contains the source code that will be run when your extension extension functions are invoked. You can replace the contents of this directory with your own code.

There are a few things to keep in mind when writing your extension code:

- Most Jan Extension functions are processed asynchronously.
  In `index.ts`, you will see that the extension function will return a `Promise<any>`.

  ```typescript
  import { core } from "@janhq/core";

  function onStart(): Promise<any> {
    return core.invokePluginFunc(MODULE_PATH, "run", 0);
  }
  ```

For more information about the Jan Extension Core module, see the [documentation](https://github.com/janhq/jan/blob/main/core/README.md).

Now, go ahead and start customizing your extension! Happy coding!