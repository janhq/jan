# Create a Jan Extension using Typescript

Use this template to bootstrap the creation of a TypeScript Jan extension. 🚀

## Create Your Own Extension

To create your own extension, you can use this repository as a template! Just follow the below instructions:

1. Click the Use this template button at the top of the repository
2. Select Create a new repository
3. Select an owner and name for your new repository
4. Click Create repository
5. Clone your new repository

## Initial Setup

After you've cloned the repository to your local machine or codespace, you'll need to perform some initial setup steps before you can develop your extension.

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

   There will be a tgz file in your extension directory now

## Update the Extension Metadata

The [`package.json`](package.json) file defines metadata about your extension, such as
extension name, main entry, description and version.

When you copy this repository, update `package.json` with the name, description for your extension.

## Update the Extension Code

The [`src/`](./src/) directory is the heart of your extension! This contains the
source code that will be run when your extension functions are invoked. You can replace the
contents of this directory with your own code.

There are a few things to keep in mind when writing your extension code:

- Most Jan Extension functions are processed asynchronously.
  In `index.ts`, you will see that the extension function will return a `Promise<any>`.

  ```typescript
  import { events, MessageEvent, MessageRequest } from '@janhq/core'

  function onStart(): Promise<any> {
    return events.on(MessageEvent.OnMessageSent, (data: MessageRequest) =>
      this.inference(data)
    )
  }
  ```

  For more information about the Jan Extension Core module, see the
  [documentation](https://github.com/janhq/jan/blob/main/core/README.md).

So, what are you waiting for? Go ahead and start customizing your extension!
