// Provide an async method to manipulate the price provided by the extension point
const getConversations = () =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc("data-plugin", "getConversations")
        .then((res) => resolve(res));
      // await window.electronAPI.invokePluginFunc("data-plugin", "init");
    } else {
      resolve([]);
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("datadriver", "getConversations", getConversations, 1);
}
