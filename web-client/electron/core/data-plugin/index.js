// Provide an async method to manipulate the price provided by the extension point
const PLUGIN_NAME = "data-plugin";

const getConversations = () =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(PLUGIN_NAME, "getConversations")
        .then((res) => resolve(res));
    } else {
      resolve([]);
    }
  });

const createConversation = (conversation) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(PLUGIN_NAME, "storeConversation", conversation)
        .then((res) => resolve(res));
    } else {
      resolve();
    }
  });

const deleteConversation = (id) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(PLUGIN_NAME, "deleteConversation", id)
        .then((res) => {
          resolve(res);
        });
    } else {
      resolve();
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("getConversations", "getConversations", getConversations, 1);
  register("createConversation", "createConversation", createConversation);
  register("deleteConversation", "deleteConversation", deleteConversation);
}
