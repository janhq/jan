---
sidebar_position: 1
title: "@janhq/models"
---

### Install
Using yarn:

```shell
yarn add @janhq/models
```

Using npm

```shell
npm i @janhq/models
```

### Import the package

```js
// javascript
const models = require("@janhq/models");

// typescript
import * as models from "@janhq/models";
```

```js
const MODEL_CATALOG_URL = models.default;

console.log(MODEL_CATALOG_URL);
// {
//   "id": "",
//   "name": "",
//   "modelUrl": "",
//   "versions": [
//      "downloadLink": "",
//     ...
//   ]
//   ...
// }
```

### How to contribute
1. Go to [Jan Models](https://github.com/janhq/models)
2. Create an Issue for new model (template incoming)
3. Create a PR for new model familly (See [The Bloke zephyr 7B alpha GGUF](https://github.com/janhq/models/blob/main/TheBloke-zephyr-7B-alpha-GGUF.json)) to `main` branch
4. Once it's merged, the new model will be on Jan models to use
