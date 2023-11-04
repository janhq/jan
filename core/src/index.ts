/**
 * CoreService exports
 */

export type CoreService =
  | StoreService
  | DataService
  | ModelManagementService
  | SystemMonitoringService
  | PreferenceService
  | PluginService;

/**
 * Represents the available methods for the StoreService.
 * @enum {string}
 */
export enum StoreService {
  /**
   * Creates a new collection in the database store.
   */
  CreateCollection = "createCollection",

  /**
   * Deletes an existing collection from the database store.
   */
  DeleteCollection = "deleteCollection",

  /**
   * Inserts a new value into an existing collection in the database store.
   */
  InsertOne = "insertOne",

  /**
   * Updates an existing value in an existing collection in the database store.
   */
  UpdateOne = "updateOne",

  /**
   * Updates multiple records in a collection in the database store.
   */
  UpdateMany = "updateMany",

  /**
   * Deletes an existing value from an existing collection in the database store.
   */
  DeleteOne = "deleteOne",

  /**
   * Delete multiple records in a collection in the database store.
   */
  DeleteMany = "deleteMany",

  /**
   * Retrieve multiple records from a collection in the data store
   */
  FindMany = "findMany",

  /**
   * Retrieve a record from a collection in the data store.
   */
  FindOne = "findOne",
}

/**
 * DataService exports.
 * @enum {string}
 */
export enum DataService {
  /**
   * Creates a new conversation using the prompt instruction.
   */
  CreateBot = "createBot",

  /**
   * Gets all created bots.
   */
  GetBots = "getBots",

  /**
   * Gets a bot matching an ID.
   */
  GetBotById = "getBotById",

  /**
   * Deletes a bot matching an ID.
   */
  DeleteBot = "deleteBot",

  /**
   * Updates a bot matching an ID.
   */
  UpdateBot = "updateBot",
}

/**
 * ModelManagementService exports.
 * @enum {string}
 */
export enum ModelManagementService {
  /**
   * Deletes a downloaded model.
   */
  DeleteModel = "deleteModel",

  /**
   * Downloads a model from the server.
   */
  DownloadModel = "downloadModel",

  /**
   * Gets configued models from the database.
   */
  GetConfiguredModels = "getConfiguredModels",

  /**
   * Stores a model in the database.
   */
  StoreModel = "storeModel",

  /**
   * Updates the finished download time for a model in the database.
   */
  UpdateFinishedDownloadAt = "updateFinishedDownloadAt",

  /**
   * Gets a list of finished download models from the database.
   */
  GetFinishedDownloadModels = "getFinishedDownloadModels",

  /**
   * Deletes a download model from the database.
   */
  DeleteDownloadModel = "deleteDownloadModel",

  /**
   * Gets a model by its ID from the database.
   */
  GetModelById = "getModelById",
}

/**
 * PreferenceService exports.
 * @enum {string}
 */
export enum PreferenceService {
  /**
   * The experiment component for which preferences are being managed.
   */
  ExperimentComponent = "experimentComponent",

  /**
   * Gets the plugin preferences.
   */
  PluginPreferences = "pluginPreferences",
}

/**
 * SystemMonitoringService exports.
 * @enum {string}
 */
export enum SystemMonitoringService {
  /**
   * Gets information about system resources.
   */
  GetResourcesInfo = "getResourcesInfo",

  /**
   * Gets the current system load.
   */
  GetCurrentLoad = "getCurrentLoad",
}

/**
 * PluginService exports.
 * @enum {string}
 */
export enum PluginService {
  /**
   * The plugin is being started.
   */
  OnStart = "pluginOnStart",

  /**
   * The plugin is being started.
   */
  OnPreferencesUpdate = "pluginPreferencesUpdate",

  /**
   * The plugin is being stopped.
   */
  OnStop = "pluginOnStop",

  /**
   * The plugin is being destroyed.
   */
  OnDestroy = "pluginOnDestroy",
}

/**
 * Store module exports.
 * @module
 */
export { store } from "./store";

/**
 * @deprecated This object is deprecated and should not be used.
 * Use individual functions instead.
 */
export { core } from "./core";

/**
 * Core module exports.
 * @module
 */
export {
  RegisterExtensionPoint,
  deleteFile,
  downloadFile,
  executeOnMain,
  invokePluginFunc,
} from "./core";

/**
 * Events module exports.
 * @module
 */
export {
  events,
  EventName,
  NewMessageRequest,
  NewMessageResponse,
  MessageHistory,
} from "./events";

/**
 * Preferences module exports.
 * @module
 */
export { preferences } from "./preferences";
export { fs } from "./fs";

export { JanPlugin, PluginType } from "./plugin";
