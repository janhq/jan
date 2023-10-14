/**
 * CoreService exports
 */

export type CoreService =
  | StoreService
  | DataService
  | InferenceService
  | ModelManagementService
  | SystemMonitoringService
  | PreferenceService;

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
   * Gets a list of conversations from the server.
   */
  GetConversations = "getConversations",

  /**
   * Creates a new conversation on the server.
   */
  CreateConversation = "createConversation",

  /**
   * Deletes an existing conversation from the server.
   */
  DeleteConversation = "deleteConversation",

  /**
   * Creates a new message in an existing conversation on the server.
   */
  CreateMessage = "createMessage",

  /**
   * Updates an existing message in an existing conversation on the server.
   */
  UpdateMessage = "updateMessage",

  /**
   * Gets a list of messages for an existing conversation from the server.
   */
  GetConversationMessages = "getConversationMessages",
}

/**
 * InferenceService exports.
 * @enum {string}
 */
export enum InferenceService {
  /**
   * The URL for the inference server.
   */
  InferenceUrl = "inferenceUrl",

  /**
   * Initializes a model for inference.
   */
  InitModel = "initModel",

  /**
   * Stops a running inference model.
   */
  StopModel = "stopModel",
}

/**
 * ModelManagementService exports.
 * @enum {string}
 */
export enum ModelManagementService {
  /**
   * Gets a list of downloaded models.
   */
  GetDownloadedModels = "getDownloadedModels",

  /**
   * Gets a list of available models from the server.
   */
  GetAvailableModels = "getAvailableModels",

  /**
   * Deletes a downloaded model.
   */
  DeleteModel = "deleteModel",

  /**
   * Downloads a model from the server.
   */
  DownloadModel = "downloadModel",

  /**
   * Searches for models on the server.
   */
  SearchModels = "searchModels",

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
   * Gets a list of unfinished download models from the database.
   */
  GetUnfinishedDownloadModels = "getUnfinishedDownloadModels",

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
 * Store module exports.
 * @module
 */
export { store } from "./store";

/**
 * Core module exports.
 * @module
 */
export { core, RegisterExtensionPoint } from "./core";
