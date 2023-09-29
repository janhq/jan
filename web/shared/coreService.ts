export type CoreService =
  | DataService
  | ModelService
  | InfereceService
  | ModelManagementService
  | SystemMonitoringService
  | PreferenceService;

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

export enum ModelService {
  GET_MODELS = "getModels",
}

export enum InfereceService {
  PROMPT = "prompt",
  INIT_MODEL = "initModel",
}

export enum ModelManagementService {
  GET_DOWNLOADED_MODELS = "getDownloadedModels",
  GET_AVAILABLE_MODELS = "getAvailableModels",
  DELETE_MODEL = "deleteModel",
  DOWNLOAD_MODEL = "downloadModel",
}

export enum PreferenceService {
  GET_EXPERIMENT_COMPONENT = "experimentComponent",
}

export enum SystemMonitoringService {
  GET_RESOURCES_INFORMATION = "getResourcesInfo",
  GET_CURRENT_LOAD_INFORMATION = "getCurrentLoad",
}
