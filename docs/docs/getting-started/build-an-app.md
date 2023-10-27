---
sidebar_position: 1
title: Build an app
---

# Build and publish an app
Apps let you extend Obsidian with your own features to create a custom note-taking experience.
In this tutorial, you'll compile a sample plugin from source code and load it into Obsidian.

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
When developing apps, one mistake can lead to unintended changes to your app. Please backup the data.

## Development
### Step 1: Download the sample plugin
- Go to [Jan sample app](https://github.com/janhq/jan-sample-app)
- Select `Use this template button` at the top of the repository
- Select `Create a new repository`
- Select an owner and name for your new repository
- Click `Create repository`
- Clone your new repository
- Start developing locally

### Step 2: Initial Setup

After you've cloned the repository to your local machine or codespace, you'll need to perform some initial setup steps before you can develop your plugin.

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

   There will be a tgz file in your plugin directory now

### Step 3: Update the Plugin Metadata

The [`package.json`](package.json) file defines metadata about your plugin, such as
plugin name, main entry, description and version.

When you copy this repository, update `package.json` with the name, description for your plugin.

### Step 4: Update the Plugin Code

The [`src/`](./src/) directory is the heart of your plugin! This contains the source code that will be run when your plugin extension functions are invoked. You can replace the contents of this directory with your own code.

There are a few things to keep in mind when writing your plugin code:

- Most Jan Plugin Extension functions are processed asynchronously.
  In `index.ts`, you will see that the extension function will return a `Promise<any>`.

  ```typescript
  import { core } from "@janhq/core";

  function onStart(): Promise<any> {
    return core.invokePluginFunc(MODULE_PATH, "run", 0);
  }
  ```

  For more information about the Jan Plugin Core module, see the
  [documentation](https://github.com/janhq/jan/blob/main/core/README.md).

- You may be confused of `index.ts` and `module.ts`.
  - `index.ts` is your UI to end customer with Web runtime. This one should be thin as lightweight. Any specific/ compute-intensive workload should be executed asynchronously in registered functions in `module.ts`.
  - `module.ts` is your Node runtime in which functions get executed.
  - `index.ts` and `module.ts` interact with each other via RPC (See [Information flow](./app-anatomy.md#information-flow))

- Define specific/ compute intensive function in `module.ts`
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

So, what are you waiting for? Go ahead and start customizing your plugin!

## App installation
![Manual installation](img/build-app-1.png)
- `Select` the built `*.tar.gz` file
- The App will reload after new app get installed

## App uninstallation
To be updated

## App update
To be updated