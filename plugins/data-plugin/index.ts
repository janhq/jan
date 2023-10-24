import {
  invokePluginFunc,
  store,
  RegisterExtensionPoint,
  StoreService,
  DataService,
  PluginService,
} from "@janhq/core";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @param     schema   schema of the collection to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createCollection({
  name,
  schema,
}: {
  name: string;
  schema?: { [key: string]: any };
}): Promise<void> {
  return invokePluginFunc(MODULE_PATH, "createCollection", name, schema);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return invokePluginFunc(MODULE_PATH, "deleteCollection", name);
}

/**
 * Insert a value to a collection
 *
 * @param     collectionName     name of the collection
 * @param     value              value to insert
 * @returns   Promise<any>
 *
 */
function insertOne({
  collectionName,
  value,
}: {
  collectionName: string;
  value: any;
}): Promise<any> {
  return invokePluginFunc(MODULE_PATH, "insertOne", collectionName, value);
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
function updateOne({
  collectionName,
  key,
  value,
}: {
  collectionName: string;
  key: string;
  value: any;
}): Promise<void> {
  return invokePluginFunc(MODULE_PATH, "updateOne", collectionName, key, value);
}

/**
 * Updates all records that match a selector in a collection in the data store.
 * @param       collectionName - The name of the collection containing the records to update.
 * @param       selector - The selector to use to get the records to update.
 * @param       value - The new value for the records.
 * @returns     {Promise<void>} A promise that resolves when the records are updated.
 */
function updateMany({
  collectionName,
  value,
  selector,
}: {
  collectionName: string;
  value: any;
  selector?: { [key: string]: any };
}): Promise<void> {
  return invokePluginFunc(
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
function deleteOne({
  collectionName,
  key,
}: {
  collectionName: string;
  key: string;
}): Promise<void> {
  return invokePluginFunc(MODULE_PATH, "deleteOne", collectionName, key);
}

/**
 * Deletes all records with a matching key from a collection in the data store.
 *
 * @param     collectionName     name of the collection
 * @param     selector           selector to use to get the records to delete.
 * @returns   {Promise<void>}
 *
 */
function deleteMany({
  collectionName,
  selector,
}: {
  collectionName: string;
  selector?: { [key: string]: any };
}): Promise<void> {
  return invokePluginFunc(MODULE_PATH, "deleteMany", collectionName, selector);
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function findOne({
  collectionName,
  key,
}: {
  collectionName: string;
  key: string;
}): Promise<any> {
  return invokePluginFunc(MODULE_PATH, "findOne", collectionName, key);
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing the record to get the value from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the value from the record.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<any>} A promise that resolves with the selected value.
 */
function findMany({
  collectionName,
  selector,
  sort,
}: {
  collectionName: string;
  selector: { [key: string]: any };
  sort?: [{ [key: string]: any }];
}): Promise<any> {
  return invokePluginFunc(
    MODULE_PATH,
    "findMany",
    collectionName,
    selector,
    sort
  );
}

function onStart() {
  createCollection({ name: "conversations", schema: {} });
  createCollection({ name: "messages", schema: {} });
  createCollection({ name: "bots", schema: {} });
}

// Register all the above functions and objects with the relevant extension points
// prettier-ignore
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);
  register(StoreService.CreateCollection, createCollection.name, createCollection);
  register(StoreService.DeleteCollection, deleteCollection.name, deleteCollection);
  
  register(StoreService.InsertOne, insertOne.name, insertOne);
  register(StoreService.UpdateOne, updateOne.name, updateOne);
  register(StoreService.UpdateMany, updateMany.name, updateMany);
  register(StoreService.DeleteOne, deleteOne.name, deleteOne);
  register(StoreService.DeleteMany, deleteMany.name, deleteMany);
  register(StoreService.FindOne, findOne.name, findOne);
  register(StoreService.FindMany, findMany.name, findMany);

  // for conversations management
  register(DataService.GetConversations, getConversations.name, getConversations);
  register(DataService.GetConversationById,getConversationById.name,getConversationById);
  register(DataService.CreateConversation, createConversation.name, createConversation);
  register(DataService.UpdateConversation, updateConversation.name, updateConversation);
  register(DataService.DeleteConversation, deleteConversation.name, deleteConversation);

  // for messages management
  register(DataService.UpdateMessage, updateMessage.name, updateMessage);
  register(DataService.CreateMessage, createMessage.name, createMessage);
  register(DataService.GetConversationMessages, getConversationMessages.name, getConversationMessages);

  // for bots management
  register(DataService.CreateBot, createBot.name, createBot);
  register(DataService.GetBots, getBots.name, getBots);
  register(DataService.GetBotById, getBotById.name, getBotById);
  register(DataService.DeleteBot, deleteBot.name, deleteBot);
  register(DataService.UpdateBot, updateBot.name, updateBot);

  // for plugin manifest
  register(DataService.GetPluginManifest, getPluginManifest.name, getPluginManifest)
}

function getConversations(): Promise<any> {
  return store.findMany("conversations", {}, [{ updatedAt: "desc" }]);
}

function getConversationById(id: string): Promise<any> {
  return store.findOne("conversations", id);
}

function createConversation(conversation: any): Promise<number | undefined> {
  return store.insertOne("conversations", conversation);
}

function updateConversation(conversation: any): Promise<void> {
  return store.updateOne("conversations", conversation._id, conversation);
}

function createMessage(message: any): Promise<number | undefined> {
  return store.insertOne("messages", message);
}

function updateMessage(message: any): Promise<void> {
  return store.updateOne("messages", message._id, message);
}

function deleteConversation(id: any) {
  return store
    .deleteOne("conversations", id)
    .then(() => store.deleteMany("messages", { conversationId: id }));
}

function getConversationMessages(conversationId: any) {
  return store.findMany("messages", { conversationId }, [
    { createdAt: "desc" },
  ]);
}

function createBot(bot: any): Promise<void> {
  console.debug("Creating bot", JSON.stringify(bot, null, 2));
  return store
    .insertOne("bots", bot)
    .then(() => {
      console.debug("Bot created", JSON.stringify(bot, null, 2));
      return Promise.resolve();
    })
    .catch((err) => {
      console.error("Error creating bot", err);
      return Promise.reject(err);
    });
}

function getBots(): Promise<any> {
  console.debug("Getting bots");
  return store
    .findMany("bots", { name: { $gt: null } })
    .then((bots) => {
      console.debug("Bots retrieved", JSON.stringify(bots, null, 2));
      return Promise.resolve(bots);
    })
    .catch((err) => {
      console.error("Error getting bots", err);
      return Promise.reject(err);
    });
}

function deleteBot(id: string): Promise<any> {
  console.debug("Deleting bot", id);
  return store
    .deleteOne("bots", id)
    .then(() => {
      console.debug("Bot deleted", id);
      return Promise.resolve();
    })
    .catch((err) => {
      console.error("Error deleting bot", err);
      return Promise.reject(err);
    });
}

function updateBot(bot: any): Promise<void> {
  console.debug("Updating bot", JSON.stringify(bot, null, 2));
  return store
    .updateOne("bots", bot._id, bot)
    .then(() => {
      console.debug("Bot updated");
      return Promise.resolve();
    })
    .catch((err) => {
      console.error("Error updating bot", err);
      return Promise.reject(err);
    });
}

function getBotById(botId: string): Promise<any> {
  console.debug("Getting bot", botId);
  return store
    .findOne("bots", botId)
    .then((bot) => {
      console.debug("Bot retrieved", JSON.stringify(bot, null, 2));
      return Promise.resolve(bot);
    })
    .catch((err) => {
      console.error("Error getting bot", err);
      return Promise.reject(err);
    });
}

/**
 * Retrieves the plugin manifest by importing the remote model catalog and clearing the cache to get the latest version.
 * A timestamp is added to the URL to prevent caching.
 * @returns A Promise that resolves with the plugin manifest.
 */
function getPluginManifest(): Promise<any> {
  // Clear cache to get the latest model catalog
  delete require.cache[
    require.resolve(/* webpackIgnore: true */ PLUGIN_CATALOG)
  ];
  // Import the remote model catalog
  // Add a timestamp to the URL to prevent caching
  return import(
    /* webpackIgnore: true */ PLUGIN_CATALOG + `?t=${Date.now()}`
  ).then((module) => module.default);
}
