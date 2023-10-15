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
function registerPreferences<T>(register: Function, pluginName: string, preferenceName: string, defaultValue: T) {
  register("PluginPreferences", `${pluginName}.${preferenceName}`, () =>
    experimentComponent(pluginName, preferenceName, defaultValue)
  );
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

// TODO: Better CSS styling
const experimentComponent = async (pluginName: string, preferenceName: string, defaultValue: any) => {
  var parent = document.createElement("div");
  parent.style.marginTop = "16px";
  const label = document.createElement("p");
  label.style.marginTop = "5px";
  label.style.fontSize = "16px";
  label.innerText = `Setting ${preferenceName}:`;
  parent.appendChild(label);

  const form = document.createElement("form");
  form.id = "Set key value";
  form.addEventListener("submit", (e: any) => {
    e.preventDefault();
    const value = new FormData(e.target).get("value");
    set(pluginName, preferenceName, value);
  });
  const input = document.createElement("input");
  input.name = "value";
  input.defaultValue = (await preferences.get(pluginName, preferenceName)) || defaultValue;
  input.style.marginTop = "3px";
  input.style.padding = "5px";
  input.style.paddingLeft = "12px";
  input.style.borderRadius = "5px";
  input.style.borderColor = "#CBD5E0";
  input.style.borderWidth = "1px";
  input.style.marginRight = "10px";
  input.style.width = "40%";
  input.style.fontSize = "14px";
  input.style.color = "#9ca3af";

  form.appendChild(input);
  const button = document.createElement("button");
  button.type = "submit";
  button.innerText = "Save";
  button.style.backgroundColor = "#3b82f6";
  button.style.color = "white";
  button.style.padding = "5px 10px";
  button.style.border = "none";
  button.style.borderRadius = "5px";
  form.appendChild(button);

  parent.appendChild(form);
  return parent;
};
