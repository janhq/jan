## @janhq/core

> This module includes functions for communicating with core APIs, the extension host's internal context for built-ins, and type definitions.

## Usage

### Import the package

```js
// Web / extension runtime
import * as core from '@janhq/core'
```

## Build an Extension

Extensions no longer extend a base class from this package. A third-party
extension exports `activate(ctx)` against the stable API in
`@janhq/extension-api` and runs in a worker; start from
`extensions-samples/hello-provider`. Built-ins in `extensions/` receive the
`InternalExtensionContext` exported here. See `extensions/CONTRIBUTING.md`.
