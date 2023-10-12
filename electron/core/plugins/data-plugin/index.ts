import {
  core,
  store,
  RegisterExtensionPoint,
  StoreService,
  DataService,
} from "@janhq/plugin-core";

// Provide an async method to manipulate the price provided by the extension point
const MODULE_PATH = "data-plugin/dist/cjs/module.js";

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
  return core.invokePluginFunc(MODULE_PATH, "createCollection", name, schema);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, "deleteCollection", name);
}

/**
 * Insert a value to a collection
 *
 * @param     collectionName     name of the collection
 * @param     value              value to insert
 * @returns   Promise<any>
 *
 */
function insertOne(collectionName: string, value: any): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, "insertOne", collectionName, value);
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
function updateOne(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return core.invokePluginFunc(
    MODULE_PATH,
    "updateOne",
    collectionName,
    key,
    value
  );
}

/**
 * Updates all records that match a selector in a collection in the data store.
 * @param       collectionName - The name of the collection containing the records to update.
 * @param       selector - The selector to use to get the records to update.
 * @param       value - The new value for the records.
 * @returns     {Promise<void>} A promise that resolves when the records are updated.
 */
function updateMany(
  collectionName: string,
  value: any,
  selector?: { [key: string]: any }
): Promise<void> {
  return core.invokePluginFunc(
    MODULE_PATH,
    "updateMany",
    collectionName,
    value,
    selector
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
function deleteOne(collectionName: string, key: string): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, "deleteOne", collectionName);
}

/**
 * Deletes all records with a matching key from a collection in the data store.
 *
 * @param     collectionName     name of the collection
 * @param     selector           selector to use to get the records to delete.
 * @returns   {Promise<void>}
 *
 */
function deleteMany(
  collectionName: string,
  selector?: { [key: string]: any }
): Promise<void> {
  return core.invokePluginFunc(MODULE_PATH, "deleteMany", {
    collectionName,
    selector,
  });
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getOne(collectionName: string, key: string): Promise<any> {
  return core.invokePluginFunc(MODULE_PATH, "getOne", collectionName, key);
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing the record to get the value from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the value from the record.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<any>} A promise that resolves with the selected value.
 */
function getMany(
  collectionName: string,
  selector: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<any> {
  return core.invokePluginFunc(
    MODULE_PATH,
    "getMany",
    collectionName,
    selector,
    sort
  );
}

const setupDb = () => {
  createCollection("conversations", {
    name: { type: "string" },
    model_id: { type: "string" },
    image: { type: "string" },
    message: { type: "string" },
    created_at: { type: "number" },
    updated_at: { type: "number" },
  });
  createCollection("messages", {
    name: { type: "string" },
    conversation_id: { type: "string" },
    user: { type: "string" },
    message: { type: "string" },
    created_at: { type: "number" },
    updated_at: { type: "number" },
  });
  createCollection("models", {
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    avatar_url: { type: "string" },
    long_description: { type: "string" },
    technical_description: { type: "string" },
    author: { type: "string" },
    version: { type: "string" },
    model_url: { type: "string" },
    type: { type: "string" },
    file_name: { type: "string" },
    download_url: { type: "string" },
    start_download_at: { type: "number" },
    finish_download_at: { type: "number" },
    created_at: { type: "number" },
    updated_at: { type: "number" },
  });
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
  register(StoreService.InsertOne, insertOne.name, insertOne);
  register(StoreService.UpdateOne, updateOne.name, updateOne);
  register(StoreService.UpdateMany, updateMany.name, updateMany);
  register(StoreService.DeleteOne, deleteOne.name, deleteOne);
  register(StoreService.DeleteMany, deleteMany.name, deleteMany);
  register(StoreService.GetOne, getOne.name, getOne);
  register(StoreService.GetMany, getMany.name, getMany);

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
/**
 * Store a model in the database when user start downloading it
 *
 * @param model Product
 */
function storeModel(model: any) {
  return store.insertOne("models", model);
}

/**
 * Update the finished download time of a model
 *
 * @param model Product
 */
function updateFinishedDownloadAt(fileName: string) {
  store.updateMany("models", { fileName }, { time: Date.now() });
}

/**
 * Get all unfinished models from the database
 */
function getUnfinishedDownloadModels() {
  store.getMany("models", { finish_download_at: -1 }, [
    { start_download_at: "desc" },
  ]);
}

function getFinishedDownloadModels() {
  store.getMany("models", { finish_download_at: 1 }, [
    { finish_download_at: "desc" },
  ]);
}

function deleteDownloadModel(modelId: string): Promise<any> {
  return store.deleteOne("models", modelId);
}

function getModelById(modelId: string): Promise<any> {
  return store.getOne("models", modelId);
}

function getConversations(): Promise<any> {
  return store.getMany("conversations", [{ updated_at: "desc" }]);
}
function createConversation(conversation: any): Promise<number | undefined> {
  return store.insertOne("conversations", conversation);
}

function createMessage(message: any): Promise<number | undefined> {
  return store.insertOne("messages", message);
}
function updateMessage(message: any): Promise<void> {
  return store.updateOne("messages", message.id, message);
}

function deleteConversation(id: any) {
  return store
    .deleteOne("conversations", id)
    .then(() => store.deleteMany("messages", { conversation_id: id }));
}

function getConversationMessages(conversation_id: any) {
  return store.getMany("messages", { conversation_id }, [{ id: "desc" }]);
}
