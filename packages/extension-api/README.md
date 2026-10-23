# @janhq/extension-api

The API for Jan desktop extensions: the `ExtensionContext` an extension's
`activate(ctx)` receives, the manifest types for the `jan` field of its
`package.json`, and the validator the app runs on install and load.

Licensed under Apache-2.0.

## Manifest

```json
{
  "name": "@acme/hello",
  "version": "0.1.0",
  "engines": { "jan": ">=0.9.0" },
  "jan": {
    "id": "acme.hello",
    "displayName": "Hello",
    "publisher": "Acme",
    "apiVersion": "^0.1.0",
    "main": "dist/index.js",
    "permissions": ["ui:notify"],
    "contributes": {
      "commands": [{ "id": "hello.greet", "title": "Greet" }]
    }
  }
}
```

Lint it with the same code the app uses:

```ts
import { validateManifest } from '@janhq/extension-api/manifest'

const result = validateManifest(JSON.parse(packageJsonText))
if (!result.ok) console.error(result.errors)
```

## Versioning

`apiVersion` must be a caret range. Before 1.0 a caret locks the minor, so
`^0.1.0` accepts host API 0.1.x only. A deprecated item stays for at least one
minor and 90 days and is removed only in a major.

## Build

```bash
yarn workspace @janhq/extension-api build   # tsc -> dist/ (ESM + .d.ts)
yarn test:packages
```
