---
title: Publishing an app
---

After you've finished developing an app locally and would like to share it with others on the "Jan marketplace", you should follow these steps:

- **Step 1:** Update your local `package.json` and configure `npm login` correctly.

- **Step 2:** Use the 'npm publish' command to publish your app as a public NPM package. This allows others to install it. 

    > For guidance, you can look at our [NPM Retrieval Plugin](https://www.npmjs.com/package/retrieval-plugin) example. 

- **Step 3:** Go to [Jan plugin catalog](https://github.com/janhq/plugin-catalog) and create a `Pull request` for new `App artifact`

    > An example can be found at the [Retrieval Plugin Example](https://github.com/janhq/plugin-catalog/blob/main/retrieval-plugin.json).

- **Step 4:** We will be responsible to review your submission and merge to `main` branch.

- **Step 5:** Once your app has been merged to `main`, it will be discoverable and available to you and other users through the "Jan marketplace."
