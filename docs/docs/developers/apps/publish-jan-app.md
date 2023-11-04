---
title: Publishing an app
---

After you have completed with local app development and want to publish to `Jan marketplace` for other to reuse, please follow the following steps

- Step 1: Update your local `package.json` and configure `npm login` correctly
- Step 2: Run `npm publish` and set to public NPM package (so that other can install) - Please refer to our example [NPM retrieval plugin](https://www.npmjs.com/package/retrieval-plugin)
- Step 3: Go to `Jan plugin catalog`(https://github.com/janhq/plugin-catalog) and create a `Pull request` for new `App artifact` (which is a renamed version of your App `package.json`) - Please refer to example [retrieval-plugin](https://github.com/janhq/plugin-catalog/blob/main/retrieval-plugin.json)
- Step 4: We at Jan will be responsible to review and merge to `main`
- Step 5: Once your new app is on `main`, you and other Jan users can find it in `Jan marketplace`
