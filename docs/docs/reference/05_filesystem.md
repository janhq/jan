---
title: "filesystem"
---

:::warning
There will be substantial updates to this feature shortly that will disrupt its current functionality or compatibility.
:::

The core package also provides functions to perform file operations. Here are a couple of examples:

## Usage

```js
// javascript
const core = require("@janhq/core");

// typescript
import * as core from "@janhq/core";
```

## Download a File

You can download a file from a specified URL and save it with a given file name using the core.downloadFile function.

```js
function downloadModel(url: string, fileName: string) {
  core.downloadFile(url, fileName);
}
```

## Delete a File

To delete a file, you can use the core.deleteFile function, providing the path to the file you want to delete.

```js
function deleteModel(filePath: string) {
  core.deleteFile(path);
}
```
