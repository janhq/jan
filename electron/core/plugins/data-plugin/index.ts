import { core, StoreService, DataService } from "@janhq/plugin-core";
import { RegisterExtensionPoint } from "@janhq/plugin-core/lib/core";

// Provide an async method to manipulate the price provided by the extension point
const MODULE_PATH = "data-plugin/dist/module.js";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @returns   Promise<void>
 *
 */
function createCollection(name: string): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, createCollection.name, name);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, deleteCollection.name, name);
}

/**
 * Insert a value to a collection
 *
 * @param     collectionName     name of the collection
 * @param     value              value to insert
 * @returns   Promise<any>
 *
 */
function insertValue(collectionName: string, value: any): Promise<any> {
  return core.invokePluginFunc(
    MODULE_PATH,
    insertValue.name,
    collectionName,
    value
  );
}

/**
 * Update value of a collection's record
 *
 * @param     collectionName     name of the collection
 * @param     key                key of the record to update
 * @param     value              value to update
 * @returns   Promise<void>
 *
 */
function updateValue(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return core.invokePluginFunc(
    MODULE_PATH,
    updateValue.name,
    collectionName,
    key,
    value
  );
}

/**
 * Delete a collection's record
 *
 * @param     collectionName     name of the collection
 * @param     key                key of the record to delete
 * @returns   Promise<void>
 *
 */
function deleteValue(collectionName: string, key: string): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, deleteValue.name, collectionName);
}

const storeModel = (model: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "storeModel", model)
      .then((res: any) => resolve(res));
  });

const getFinishedDownloadModels = () =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "getFinishedDownloadModels")
      .then((res: any) => resolve(res));
  });

const getModelById = (modelId: string) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "getModelById", modelId)
      .then((res: any) => resolve(res));
  });

const updateFinishedDownloadAt = (fileName: string) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(
        MODULE_PATH,
        "updateFinishedDownloadAt",
        fileName,
        Date.now()
      )
      .then((res: any) => resolve(res));
  });

const getUnfinishedDownloadModels = () =>
  new Promise<any>((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "getUnfinishedDownloadModels")
      .then((res: any[]) => resolve(res));
  });

const deleteDownloadModel = (modelId: string) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "deleteDownloadModel", modelId)
      .then((res: any) => resolve(res));
  });

const getConversations = () =>
  new Promise<any>((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "getConversations")
      .then((res: any[]) => resolve(res));
  });
const getConversationMessages = (id: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "getConversationMessages", id)
      .then((res: any[]) => resolve(res));
  });

const createConversation = (conversation: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "storeConversation", conversation)
      .then((res: any) => {
        resolve(res);
      });
  });

const createMessage = (message: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "storeMessage", message)
      .then((res: any) => {
        resolve(res);
      });
  });

const updateMessage = (message: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "updateMessage", message)
      .then((res: any) => {
        resolve(res);
      });
  });

const deleteConversation = (id: any) =>
  new Promise((resolve) => {
    core
      .invokePluginFunc(MODULE_PATH, "deleteConversation", id)
      .then((res: any) => {
        resolve(res);
      });
  });

const setupDb = () => {
  core.invokePluginFunc(MODULE_PATH, setupDb.name);
};

// Register all the above functions and objects with the relevant extension points
export function init({ register }: { register: RegisterExtensionPoint }) {
  setupDb();

  register(
    StoreService.CreateCollection,
    createCollection.name,
    createCollection
  );
  register(
    StoreService.DeleteCollection,
    deleteCollection.name,
    deleteCollection
  );
  register(StoreService.InsertValue, insertValue.name, insertValue);
  register(StoreService.UpdateValue, updateValue.name, updateValue);
  register(StoreService.DeleteValue, deleteValue.name, deleteValue);

  register(
    DataService.GetConversations,
    getConversations.name,
    getConversations
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

  // TODO: Move to Model Management Plugin
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
