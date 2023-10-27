---
title: "init"
---

`init` is the main entrypoint for mounting your application and its custom logic. It is a reserved function that Jan will look for to initialize your application.

## Usage

```js
// javascript
const core = require("@janhq/core");

// typescript
import * as core from "@janhq/core";
```

## init

TODO

## RegisterExtensionPoint

`RegisterExtensionPoint` is used for app initialization.

It lets you register functions/methods with the main application.

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

```js
// index.ts
function foo(id: number) {
  return core.invokePluginFunc(MODULE_PATH, "getConvMessages", id);
}
```
