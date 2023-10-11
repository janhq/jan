import { DataService } from "@janhq/plugin-core";

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
  register(
    DataService.GetConversations,
    getConversations.name,
    getConversations,
    1
  );
  register(
    DataService.CreateConversation,
    createConversation.name,
    createConversation
  );
  register(DataService.UpdateMessage, updateMessage.name, updateMessage);
  register(
    DataService.DeleteConversation,
    deleteConversation.name,
    deleteConversation
  );
  register(DataService.CreateMessage, createMessage.name, createMessage);
  register(
    DataService.GetConversationMessages,
    getConversationMessages.name,
    getConversationMessages
  );
  register(DataService.StoreModel, storeModel.name, storeModel);
  register(
    DataService.UpdateFinishedDownloadAt,
    updateFinishedDownloadAt.name,
    updateFinishedDownloadAt
  );
  register(
    DataService.GetUnfinishedDownloadModels,
    getUnfinishedDownloadModels.name,
    getUnfinishedDownloadModels
  );
  register(
    DataService.DeleteDownloadModel,
    deleteDownloadModel.name,
    deleteDownloadModel
  );
  register(DataService.GetModelById, getModelById.name, getModelById);
  register(
    DataService.GetFinishedDownloadModels,
    getFinishedDownloadModels.name,
    getFinishedDownloadModels
  );
}
