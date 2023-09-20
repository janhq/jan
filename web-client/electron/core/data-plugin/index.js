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
const getConversationMessages = (id) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(PLUGIN_NAME, "getConversationMessages", id)
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
const createMessage = (message) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(PLUGIN_NAME, "storeMessage", message)
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

const setupDb = () => {
  window.electronAPI.invokePluginFunc(PLUGIN_NAME, "init");
};

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  setupDb();
  register("getConversations", "getConv", getConversations, 1);
  register("createConversation", "insertConv", createConversation);
  register("deleteConversation", "deleteConv", deleteConversation);
  register("createMessage", "insertMessage", createMessage);
  register("getConversationMessages", "getMessages", getConversationMessages);
}
