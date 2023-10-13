## @janhq/plugin-core

> The module includes functions for communicating with core APIs, registering plugin extensions, and exporting type definitions.

## Usage

### Import the package

```js
// javascript
const core = require("@janhq/plugin-core");

// typescript
import { core } from "@janhq/plugin-core";
```

#### Register Plugin Extensions

Every plugin must define an `init` function in its main entry file to initialize the plugin and register its extensions with the Jan platform.

You can `register` any function as a plugin extension using a unique entry name. For example, the `DataService.GetConversations` entry name can be used to register a function that retrieves conversations.

Once the extension is registered, it can be used by other plugins or components in the Jan platform. For example, a UI component might use the DataService.GetConversations extension to retrieve a list of conversations to display to the user.

```js
import { RegisterExtensionPoint, DataService } from "@janhq/plugin-core";

function getConversations() {
  // Your logic here
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(DataService.GetConversations, getConversations.name, getConversations);
}
```

#### Access Core API

```js
// index.ts
import { store, core } from "@janhq/plugin-core";

function insertData() {
  store.insertOne("conversations", { name: "meow" });
  store.getMany("conversations", { name: "meow" });
}

function downloadModel(url: string, fileName: string) {
  core.downloadFile(url, fileName)
}

function deleteModel(filePath: string) {
  core.deleteFile(path)
}
```

#### Execute plugin module in main process

```js
// index.ts
import { core } from "@janhq/plugin-core";

const MODULE_PATH = "data-plugin/dist/module.js";

function getConversationMessages(id: number) {
  return core.invokePluginFunc(MODULE_PATH, "getConvMessages", id);
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(DataService.GetConversationMessages, getConversationMessages.name, getConversationMessages);
}

// module.ts
function getConvMessages(id: number) {
  // Your logic here
}
```
