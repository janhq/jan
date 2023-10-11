import {
  core,
  RegisterExtensionPoint,
  StoreService,
  DataService,
} from "@janhq/plugin-core";

// Provide an async method to manipulate the price provided by the extension point
const MODULE_PATH = "data-plugin/dist/module.js";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @param     schema   schema of the collection to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createCollection(
  name: string,
  schema: { [key: string]: any }
): Promise<void> {
  return core.invokePluginFunc(
    MODULE_PATH,
    createCollection.name,
    name,
    schema
  );
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

/**
 * Retrieve all records from a collection in the data store.
 * @param {string} collectionName - The name of the collection to retrieve.
 * @returns {Promise<any>} A promise that resolves when all records are retrieved.
 */
function getAllValues(collectionName: string): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, getAllValues.name, collectionName);
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getValue(collectionName: string, key: string): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, getValue.name, collectionName, key);
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing the record to get the value from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the value from the record.
 * @returns {Promise<any>} A promise that resolves with the selected value.
 */
function getValuesBySelector(
  collectionName: string,
  selector: { [key: string]: any }
): Promise<any> {
  return core.invokePluginFunc(
    MODULE_PATH,
    getValuesBySelector.name,
    collectionName,
    selector
  );
}

const storeModel = (model: any) =>
  core.invokePluginFunc(MODULE_PATH, "storeModel", model);

const getFinishedDownloadModels = () =>
  core.invokePluginFunc(MODULE_PATH, "getFinishedDownloadModels");

const getModelById = (modelId: string) =>
  core.invokePluginFunc(MODULE_PATH, "getModelById", modelId);

const updateFinishedDownloadAt = (fileName: string) =>
  core.invokePluginFunc(
    MODULE_PATH,
    "updateFinishedDownloadAt",
    fileName,
    Date.now()
  );

const getUnfinishedDownloadModels = () =>
  core.invokePluginFunc(MODULE_PATH, "getUnfinishedDownloadModels");

const deleteDownloadModel = (modelId: string) =>
  core.invokePluginFunc(MODULE_PATH, "deleteDownloadModel", modelId);

const getConversations = () =>
  core.invokePluginFunc(MODULE_PATH, "getConversations");
const getConversationMessages = (id: any) =>
  core.invokePluginFunc(MODULE_PATH, "getConversationMessages", id);

const createConversation = (conversation: any) =>
  core.invokePluginFunc(MODULE_PATH, "storeConversation", conversation);
const createMessage = (message: any) =>
  core.invokePluginFunc(MODULE_PATH, "storeMessage", message);

const updateMessage = (message: any) =>
  core.invokePluginFunc(MODULE_PATH, "updateMessage", message);

const deleteConversation = (id: any) =>
  core.invokePluginFunc(MODULE_PATH, "deleteConversation", id);

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
  register(StoreService.GetAllValues, getAllValues.name, getAllValues);
  register(StoreService.GetValue, getValue.name, getValue);
  register(
    StoreService.GetValuesBySelector,
    getValuesBySelector.name,
    getValuesBySelector
  );

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
