/**
 * CoreService exports
 */

import { StoreService } from "./core";

export type CoreService =
  | StoreService
  | DataService
  | ModelService
  | InferenceService
  | ModelManagementService
  | SystemMonitoringService
  | PreferenceService;

/**
 * DataService exports
 */
export enum DataService {
  GetConversations = "getConversations",
  CreateConversation = "createConversation",
  DeleteConversation = "deleteConversation",
  CreateMessage = "createMessage",
  UpdateMessage = "updateMessage",
  GetConversationMessages = "getConversationMessages",

  StoreModel = "storeModel",
  UpdateFinishedDownloadAt = "updateFinishedDownloadAt",
  GetUnfinishedDownloadModels = "getUnfinishedDownloadModels",
  GetFinishedDownloadModels = "getFinishedDownloadModels",
  DeleteDownloadModel = "deleteDownloadModel",

  GetModelById = "getModelById",
}

/**
 * ModelService exports
 */
export enum ModelService {
  GetModels = "getModels",
}

/**
 * ModelService exports
 */
export enum InferenceService {
  InferenceUrl = "inferenceUrl",
  InitModel = "initModel",
  StopModel = "stopModel",
}

/**
 * ModelManagementService exports
 */
export enum ModelManagementService {
  GetDownloadedModels = "getDownloadedModels",
  GetAvailableModels = "getAvailableModels",
  DeleteModel = "deleteModel",
  DownloadModel = "downloadModel",
  SearchModels = "searchModels",
}

/**
 * PreferenceService exports
 */
export enum PreferenceService {
  ExperimentComponent = "experimentComponent",
}

/**
 * SystemMonitoringService exports
 */
export enum SystemMonitoringService {
  GetResourcesInfo = "getResourcesInfo",
  GetCurrentLoad = "getCurrentLoad",
}

export { store } from "./store";
export { Core } from "./core";
