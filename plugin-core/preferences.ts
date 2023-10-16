import { store } from "./store";

/**
 * Returns the value of the specified preference for the specified plugin.
 *
 * @param pluginName The name of the plugin.
 * @param preferenceName The name of the preference.
 * @returns A promise that resolves to the value of the preference.
 */
function get(pluginName: string, preferenceName: string): Promise<any> {
  return store
    .createCollection("preferences", {})
    .then(() => store.findOne("preferences", `${pluginName}.${preferenceName}`))
    .then((doc) => doc?.value ?? "");
}

/**
 * Sets the value of the specified preference for the specified plugin.
 *
 * @param pluginName The name of the plugin.
 * @param preferenceName The name of the preference.
 * @param value The value of the preference.
 * @returns A promise that resolves when the preference has been set.
 */
function set(pluginName: string, preferenceName: string, value: any): Promise<any> {
  return store
    .createCollection("preferences", {})
    .then(() =>
      store
        .findOne("preferences", `${pluginName}.${preferenceName}`)
        .then((doc) =>
          doc
            ? store.updateOne("preferences", `${pluginName}.${preferenceName}`, { value })
            : store.insertOne("preferences", { _id: `${pluginName}.${preferenceName}`, value })
        )
    );
}

/**
 * Clears all preferences for the specified plugin.
 *
 * @param pluginName The name of the plugin.
 * @returns A promise that resolves when the preferences have been cleared.
 */
function clear(pluginName: string): Promise<void> {
  return Promise.resolve();
}

/**
 * Registers a preference with the specified default value.
 *
 * @param register The function to use for registering the preference.
 * @param pluginName The name of the plugin.
 * @param preferenceName The name of the preference.
 * @param defaultValue The default value of the preference.
 */
function registerPreferences<T>(
  register: Function,
  pluginName: string,
  preferenceKey: string,
  preferenceName: string,
  preferenceDescription: string,
  defaultValue: T
) {
  register("PluginPreferences", `${pluginName}.${preferenceKey}`, () => ({
    pluginName,
    preferenceKey,
    preferenceName,
    preferenceDescription,
    defaultValue,
  }));
}

/**
 * An object that provides methods for getting, setting, and clearing preferences.
 */
export const preferences = {
  get,
  set,
  clear,
  registerPreferences,
};
