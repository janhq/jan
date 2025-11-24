## @janhq/core

> This module includes functions for communicating with core APIs, registering app extensions, and exporting type definitions.

## Usage

### Import the package

```js
// Web / extension runtime
import * as core from '@janhq/core'
```

## Build an Extension

1. Download an extension template, for example, [https://github.com/janhq/extension-template](https://github.com/janhq/extension-template).

2. Update the source code:

   1. Open `index.ts` in your code editor.
   2. Rename the extension class from `SampleExtension` to your preferred extension name.
   3. Import modules from the core package.
      ```ts
      import * as core from '@janhq/core'
      ```
   4. In the `onLoad()` method, add your code:

      ```ts
      // Example of listening to app events and providing customized inference logic:
      import * as core from '@janhq/core'

      export default class MyExtension extends BaseExtension {
        // On extension load
        onLoad() {
          core.events.on(MessageEvent.OnMessageSent, (data) => MyExtension.inference(data, this))
        }

        // Customized inference logic
        private static inference(incomingMessage: MessageRequestData) {
          // Prepare customized message content
          const content: ThreadContent = {
            type: ContentType.Text,
            text: {
              value: "I'm Jan Assistant!",
              annotations: [],
            },
          }

          // Modify message and send out
          const outGoingMessage: ThreadMessage = {
            ...incomingMessage,
            content,
          }
        }
      }
      ```

3. Build the extension:
   1. Navigate to the extension directory.
   2. Install dependencies.
      ```bash
      yarn install
      ```
   3. Compile the source code. The following command keeps running in the terminal and rebuilds the extension when you modify the source code.
      ```bash
      yarn build
      ```
   4. Select the generated .tgz from Jan > Settings > Extension > Manual Installation.
