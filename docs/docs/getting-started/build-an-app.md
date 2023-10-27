---
sidebar_position: 1
title: Build an app
---

# Build and publish an app

You can build a custom AI application on top of Jan.
In this tutorial, you'll build a sample app and load it into Jan Desktop.

## What you'll learn

After you've completed this tutorial, you'll be able to:

- Configure an environment for developing Jan apps.
- Compile a app from source code.
- Reload a app after making changes to it.

## Prerequisites

To complete this tutorial, you'll need:

- [Git](https://git-scm.com/) installed on your local machine.
- A local development environment for [Node.js](https://node.js.org/en/about/).
- A code editor, such as [Visual Studio Code](https://code.visualstudio.com/).

## Before you start

When developing apps, one mistake can lead to unintended changes to your app. Please backup your data.

## Development

### Step 1: Download the sample app

- Go to [Jan sample app](https://github.com/janhq/jan-sample-app)
- Select `Use this template button` at the top of the repository
- Select `Create a new repository`
- Select an owner and name for your new repository
- Click `Create repository`
- Git clone your new repository

### Step 2: Initial Setup

Next, you'll need to perform some initial setup steps.

> [!NOTE]
>
> You'll need to have a reasonably modern version of
> [Node.js](https://nodejs.org) handy. If you are using a version manager like
> [`nodenv`](https://github.com/nodenv/nodenv) or
> [`nvm`](https://github.com/nvm-sh/nvm), you can run `nodenv install` in the
> root of your repository to install the version specified in
> [`package.json`](./package.json). Otherwise, 20.x or later should work!

1. :hammer_and_wrench: Install the dependencies

   ```bash
   npm install
   ```

1. :building_construction: Package the TypeScript for distribution

   ```bash
   npm run bundle
   ```

1. :white_check_mark: Check your artifact

   There will be a tgz file in your src directory now

### Step 3: Update the App Manifest

The [`package.json`](package.json) file lets you define your apps metadata, e.g.
app name, main entry, description and version.

### Step 4: Update the Plugin Code

The [`src/`](./src/) directory is the heart of your app!

- `index.ts` is your UI to end customer with Web runtime. This one should be thin as lightweight. Any specific/ compute-intensive workload should be executed asynchronously in registered functions in `module.ts`.
- `module.ts` is your Node runtime in which functions get executed.
- `index.ts` and `module.ts` interact with each other via RPC (See [Information flow](./app-anatomy.md#information-flow))

You can replace the contents of this directory with your own code.

#### index.ts

Think of this as your "app frontend". You register events, custom functions here.

Most Jan App functions are processed asynchronously.
In `index.ts`, you will see that the extension function will return a `Promise<any>`.

```typescript
import { core } from "@janhq/core";

function onStart(): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, "run", 0);
}
```

- Define functions to register and use the registered function in `index.ts`

```javascript
/**
 * The entrypoint for the plugin.
 */

import { PluginService, RegisterExtensionPoint, core } from "@janhq/core";

/**
 * Invokes the `run` function from the `module.js` file using the `invokePluginFunc` method.
 * "run" is the name of the function to invoke.
 * @returns {Promise<any>} A promise that resolves with the result of the `run` function.
 */
function onStart(): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, "run", 0);
}

/**
 * Initializes the plugin by registering the extension functions with the given register function.
 * @param {Function} options.register - The function to use for registering the extension functions
 */
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);
}
```

For more information about the Core module, see the
[documentation](https://github.com/janhq/jan/blob/main/core/README.md).

#### module.ts

Think of this as your "app backend". Your core logic implementation goes here.

```javascript
const path = require("path");
const { app } = require("electron");

function run(param: number): [] {
  console.log(`execute runner ${param} in main process`);
  return [];
}

module.exports = {
  run,
};
```

So, what are you waiting for? Go ahead and start customizing your plugin!

## App installation

![Manual installation](img/build-app-1.png)

- `Select` the built `*.tar.gz` file
- The App will reload after new app get installed

## App uninstallation

To be updated

## App update

To be updated
