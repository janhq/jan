---
title: Build Your First Engine
slug: /developer/build-engine/build-your-first-engine/
description: A quick start on how to build your first engine.
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
    build engine,
  ]
---

To quickly build your own inference engine using Jan's template, follow the steps below:

## Step 1: Clone or Download the Jan Extension Template
1. Navigate to the Extension Template repository here: https://github.com/janhq/extension-template.
2. Clone or download the repository.

## Step 2: Setup the Plugin Metadata
1. Navigate to the `package.json` file.
2. Update your plugin metadata such as:
    - Name
    - Main Entry
    - Description
    - Version

## Step 3: Update the Engine Code
You can update the plugin source code provided in the extension template in `/src` folder with your own code. The source code will be run when your plugin extension functions are invoked. The source code will also tell how your plugin behaves when added to Jan. To update, follow the steps below:
1. Navigate to the `/src` folder.
2. Select the `index.ts` file.
3. Customize the code to your needs.

:::note
Most functions in Jan Plugin Extensions operate asynchronously.
:::

## Step 4: Setup the Engine
1. Navigate to your engine folder.
2. Install the dependencies using the following command:

```bash
npm install
```
3. Compile the source code using the following command:
```bash
npm run build
```

## Step 5: Install the Engine
1. Navigate to your plugin folder.
2. Bundle the Typescript files into a single bundled assets `tgz` file by using the following command:

```bash
npm run bundle
```
3. Open your Jan application.
4. Click **Settings** > **Extensions**.
5. Click the **Select** button next to the **Manual Import** section.
6. Select the `.tgz` file that you have generated.
