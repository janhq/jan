## @janhq/plugin-core

> The module includes functions for communicating with core APIs, registering plugin extensions, and exporting type definitions.

## Usage

### Import the package

```js
// javascript
const core = require("@janhq/plugin-core");

// typescript
import * as core from "@janhq/plugin-core";
```

#### Register Plugin Extension

```js
import { RegisterExtensionPoint, DataService } from "@janhq/plugin-core";

function getConversations() {
    // Your logic here
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(
    DataService.GetConversations,
    getConversations.name,
    getConversations
  );
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
  register(
    DataService.GetConversationMessages,
    getConversationMessages.name,
    getConversationMessages
  );
}

// module.ts
function getConvMessages(id: number) {
    // Your logic here
}
```

#### Access Core API

```js
// index.ts
import { store } from "@janhq/plugin-core";

function insertData() {
    store.insertValue("collection_name", "value")
}
```