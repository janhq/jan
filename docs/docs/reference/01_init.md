---
title: "init"
---

:::warning
There will be substantial updates to this feature shortly that will disrupt its current functionality or compatibility.
:::

`init` is the entrypoint for your application and its custom logic. `init` is a reserved function that Jan will look for to initialize your application.

## Usage

Importing

```js
// javascript
const core = require("@janhq/core");

// typescript
import * as core from "@janhq/core";
```

Setting up event listeners

```js
export function init({ register }) {
  myListener();
}
```

Setting up core service implementation

```js
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(DataService.GetConversations, "my-app-id", myImplementation);
}
```

## RegisterExtensionPoint

`RegisterExtensionPoint` is used for app initialization.

It lets you register `CoreService` functions/methods with the main application.

```js
import { RegisterExtensionPoint } from "@janhq/core";
```

```js
type RegisterExtensionPoint = (
  extensionName: string,
  extensionId: string,
  method: Function,
  priority?: number
)
```

## invokePluginFunc

`invokePluginFunc` is a way to invoke your custom functions (defined in your `module.ts`) from your application client (defined in your `index.ts`)

```js
// index.ts: your application "frontend" and entrypoint
function foo(id: number) {
  return core.invokePluginFunc(MODULE_PATH, "foo", param1, ...);
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(Service.Foo, "my-app-id", foo);
}
```

```js
// module.ts: your application "backend"
export function foo(param1, ...) {
  // Your code here
}
```
