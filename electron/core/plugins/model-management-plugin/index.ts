import {
  ModelManagementService,
  RegisterExtensionPoint,
  core,
  store,
} from "@janhq/plugin-core";
const MODULE_PATH = "model-management-plugin/dist/module.js";

const getDownloadedModels = () =>
  core.invokePluginFunc(MODULE_PATH, "getDownloadedModels");

const getAvailableModels = () =>
  core.invokePluginFunc(MODULE_PATH, "getAvailableModels");

const downloadModel = (product) =>
  core.downloadFile(product.downloadUrl, product.fileName);

const deleteModel = (path) => core.deleteFile(path);

const searchModels = (params) =>
  core.invokePluginFunc(MODULE_PATH, "searchModels", params);

const getConfiguredModels = () =>
  core.invokePluginFunc(MODULE_PATH, "getConfiguredModels");

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
function updateFinishedDownloadAt(fileName: string): Promise<any> {
  return store.updateMany(
    "models",
    { fileName },
    { time: Date.now(), finishDownloadAt: 1 }
  );
}

/**
 * Get all unfinished models from the database
 */
function getUnfinishedDownloadModels(): Promise<any> {
  return store.findMany("models", { finishDownloadAt: -1 }, [
    { startDownloadAt: "desc" },
  ]);
}

function getFinishedDownloadModels(): Promise<any> {
  return store.findMany("models");
}

function deleteDownloadModel(modelId: string): Promise<any> {
  return store.deleteOne("models", modelId);
}

function getModelById(modelId: string): Promise<any> {
  return store.findOne("models", modelId);
}

function onStart() {
  store.createCollection("models", {});
}
// Register all the above functions and objects with the relevant extension points
export function init({ register }: { register: RegisterExtensionPoint }) {
  onStart();

  register(
    ModelManagementService.GetDownloadedModels,
    getDownloadedModels.name,
    getDownloadedModels
  );
  register(
    ModelManagementService.GetAvailableModels,
    getAvailableModels.name,
    getAvailableModels
  );
  register(
    ModelManagementService.DownloadModel,
    downloadModel.name,
    downloadModel
  );
  register(ModelManagementService.DeleteModel, deleteModel.name, deleteModel);
  register(
    ModelManagementService.SearchModels,
    searchModels.name,
    searchModels
  );
  register(
    ModelManagementService.GetConfiguredModels,
    getConfiguredModels.name,
    getConfiguredModels
  );

  register(ModelManagementService.StoreModel, storeModel.name, storeModel);
  register(
    ModelManagementService.UpdateFinishedDownloadAt,
    updateFinishedDownloadAt.name,
    updateFinishedDownloadAt
  );
  register(
    ModelManagementService.GetUnfinishedDownloadModels,
    getUnfinishedDownloadModels.name,
    getUnfinishedDownloadModels
  );
  register(
    ModelManagementService.DeleteDownloadModel,
    deleteDownloadModel.name,
    deleteDownloadModel
  );
  register(
    ModelManagementService.GetModelById,
    getModelById.name,
    getModelById
  );
  register(
    ModelManagementService.GetFinishedDownloadModels,
    getFinishedDownloadModels.name,
    getFinishedDownloadModels
  );
}
