/**
 * CoreService exports
 */
export type CoreService =
  | DataService
  | ModelService
  | InfereceService
  | ModelManagementService
  | SystemMonitoringService
  | PreferenceService;

/**
 * DataService exports
 */
export enum DataService {
  GET_CONVERSATIONS = "getConversations",
  CREATE_CONVERSATION = "createConversation",
  DELETE_CONVERSATION = "deleteConversation",
  CREATE_MESSAGE = "createMessage",
  UPDATE_MESSAGE = "updateMessage",
  GET_CONVERSATION_MESSAGES = "getConversationMessages",

  STORE_MODEL = "storeModel",
  UPDATE_FINISHED_DOWNLOAD = "updateFinishedDownloadAt",
  GET_UNFINISHED_DOWNLOAD_MODELS = "getUnfinishedDownloadModels",
  GET_FINISHED_DOWNLOAD_MODELS = "getFinishedDownloadModels",
  DELETE_DOWNLOAD_MODEL = "deleteDownloadModel",

  GET_MODEL_BY_ID = "getModelById",
}

/**
 * ModelService exports
 */
export enum ModelService {
  GET_MODELS = "getModels",
}

/**
 * ModelService exports
 */
export enum InfereceService {
  INFERENCE_URL = "inferenceUrl",
  INIT_MODEL = "initModel",
  STOP_MODEL = "stopModel",
}

/**
 * ModelManagementService exports
 */
export enum ModelManagementService {
  GET_DOWNLOADED_MODELS = "getDownloadedModels",
  GET_AVAILABLE_MODELS = "getAvailableModels",
  DELETE_MODEL = "deleteModel",
  DOWNLOAD_MODEL = "downloadModel",
  SEARCH_MODELS = "searchModels",
}

/**
 * PreferenceService exports
 */
export enum PreferenceService {
  GET_EXPERIMENT_COMPONENT = "experimentComponent",
}

/**
 * SystemMonitoringService exports
 */
export enum SystemMonitoringService {
  GET_RESOURCES_INFORMATION = "getResourcesInfo",
  GET_CURRENT_LOAD_INFORMATION = "getCurrentLoad",
}

export { store } from "./store";
