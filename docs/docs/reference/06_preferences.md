---
title: "preferences"
---

:::warning
There will be substantial updates to this feature shortly that will disrupt its current functionality or compatibility.
:::

`preferences` is a helper object for adding settings fields to your app.

## Usage

To register plugin preferences, you can use the preferences object from the @janhq/core package. Here's an example of how to register and retrieve plugin preferences:

```js
import { PluginService, preferences } from "@janhq/core";

const pluginName = "your-first-plugin";
const preferenceKey = "";
const preferenceName = "Your First Preference";
const preferenceDescription = "This is for example only";
const defaultValue = "";

export function init({ register }: { register: RegisterExtensionPoint }) {
  // Register preference update handlers. E.g. update plugin instance with new configuration
  register(PluginService.OnPreferencesUpdate, pluginName, onPreferencesUpdate);

  // Register plugin preferences. E.g. Plugin need apiKey to connect to your service
  preferences.registerPreferences <
    string >
    (register,
    pluginName,
    preferenceKey,
    preferenceName,
    preferenceDescription,
    defaultValue);
}
```

In this example, we're registering preference update handlers and plugin preferences using the preferences object. We're also defining a PluginName constant to use as the name of the plugin.

To retrieve the values of the registered preferences, we're using the get method of the preferences object and passing in the name of the plugin and the name of the preference.

```js
import { preferences } from "@janhq/core";

const pluginName = "your-first-plugin";
const preferenceKey = "apiKey";

const setup = async () => {
  // Retrieve apiKey
  const apiKey: string =
    (await preferences.get(pluginName, preferenceKey)) ?? "";
};
```

## registerPreferences

## get

## set

## clear
