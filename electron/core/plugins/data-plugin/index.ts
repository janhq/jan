// Provide an async method to manipulate the price provided by the extension point
const MODULE_PATH = "data-plugin/dist/module.js";

const storeModel = (model: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "storeModel", model)
        .then((res: any) => resolve(res));
    }
  });

const getFinishedDownloadModels = () =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getFinishedDownloadModels")
        .then((res: any) => resolve(res));
    }
  });

const getModelById = (modelId: string) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getModelById", modelId)
        .then((res: any) => resolve(res));
    }
  });

const updateFinishedDownloadAt = (fileName: string) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(
          MODULE_PATH,
          "updateFinishedDownloadAt",
          fileName,
          Date.now()
        )
        .then((res: any) => resolve(res));
    }
  });

const getUnfinishedDownloadModels = () =>
  new Promise<any>((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getUnfinishedDownloadModels")
        .then((res: any[]) => resolve(res));
    } else {
      resolve([]);
    }
  });

const deleteDownloadModel = (modelId: string) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "deleteDownloadModel", modelId)
        .then((res: any) => resolve(res));
    }
  });

const getConversations = () =>
  new Promise<any>((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getConversations")
        .then((res: any[]) => resolve(res));
    } else {
      resolve([]);
    }
  });
const getConversationMessages = (id: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getConversationMessages", id)
        .then((res: any[]) => resolve(res));
    } else {
      resolve([]);
    }
  });

const createConversation = (conversation: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "storeConversation", conversation)
        .then((res: any) => {
          resolve(res);
        });
    } else {
      resolve(undefined);
    }
  });

const createMessage = (message: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "storeMessage", message)
        .then((res: any) => {
          resolve(res);
        });
    } else {
      resolve(undefined);
    }
  });

const updateMessage = (message: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "updateMessage", message)
        .then((res: any) => {
          resolve(res);
        });
    } else {
      resolve(undefined);
    }
  });

const deleteConversation = (id: any) =>
  new Promise((resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "deleteConversation", id)
        .then((res: any) => {
          resolve(res);
        });
    } else {
      resolve("-");
    }
  });

const setupDb = () => {
  window.electronAPI.invokePluginFunc(MODULE_PATH, "init");
};

// Register all the above functions and objects with the relevant extension points
export function init({ register }: { register: any }) {
  setupDb();
  register("getConversations", "getConv", getConversations, 1);
  register("createConversation", "insertConv", createConversation);
  register("updateMessage", "updateMessage", updateMessage);
  register("deleteConversation", "deleteConv", deleteConversation);
  register("createMessage", "insertMessage", createMessage);
  register("getConversationMessages", "getMessages", getConversationMessages);
  register("storeModel", "storeModel", storeModel);
  register(
    "updateFinishedDownloadAt",
    "updateFinishedDownloadAt",
    updateFinishedDownloadAt
  );
  register(
    "getUnfinishedDownloadModels",
    "getUnfinishedDownloadModels",
    getUnfinishedDownloadModels
  );
  register("deleteDownloadModel", "deleteDownloadModel", deleteDownloadModel);
  register("getModelById", "getModelById", getModelById);
  register(
    "getFinishedDownloadModels",
    "getFinishedDownloadModels",
    getFinishedDownloadModels
  );
}
