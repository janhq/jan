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
    "apiVersion": "^1.0.0",
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

`apiVersion` must be a caret range. `^1.0.0` accepts any host API 1.x, so an
extension built against 1.0 keeps working on later 1.x hosts. A deprecated
item stays for at least one minor and 90 days and is removed only in a major.

Every change to the public declarations shows up as a diff of the committed
`api-report.d.ts`; `src/__tests__/api-report.test.ts` fails until it is
regenerated with `yarn workspace @janhq/extension-api api-report`.

## Build

```bash
yarn workspace @janhq/extension-api build   # tsc -> dist/ (ESM + .d.ts)
yarn test:packages
```
