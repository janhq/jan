import { ModelManagementService, PluginService, RegisterExtensionPoint, core, store } from "@janhq/core";

const getDownloadedModels = () => core.invokePluginFunc(MODULE_PATH, "getDownloadedModels");

const getAvailableModels = () => core.invokePluginFunc(MODULE_PATH, "getAvailableModels");

const downloadModel = (product) => core.downloadFile(product.downloadUrl, product.fileName);

const deleteModel = (path) => core.deleteFile(path);

const searchModels = (params) => core.invokePluginFunc(MODULE_PATH, "searchModels", params);

const getConfiguredModels = () => core.invokePluginFunc(MODULE_PATH, "getConfiguredModels");

/**
 * Store a model in the database when user start downloading it
 *
 * @param model Product
 */
function storeModel(model: any) {
  return store.findOne("models", model._id).then((doc) => {
    if (doc) {
      return store.updateOne("models", model._id, model);
    } else {
      return store.insertOne("models", model);
    }
  });
}

/**
 * Update the finished download time of a model
 *
 * @param model Product
 */
function updateFinishedDownloadAt(_id: string): Promise<any> {
  return store.updateMany("models", { _id }, { time: Date.now(), finishDownloadAt: 1 });
}

/**
 * Retrieves all unfinished models from the database.
 *
 * @returns A promise that resolves with an array of unfinished models.
 */
function getUnfinishedDownloadModels(): Promise<any> {
  return store.findMany("models", { finishDownloadAt: -1 }, [{ startDownloadAt: "desc" }]);
}

/**
 * Retrieves all finished models from the database.
 *
 * @returns A promise that resolves with an array of finished models.
 */
function getFinishedDownloadModels(): Promise<any> {
  return store.findMany("models", { finishDownloadAt: 1 });
}

/**
 * Deletes a model from the database.
 *
 * @param modelId The ID of the model to delete.
 * @returns A promise that resolves when the model is deleted.
 */
function deleteDownloadModel(modelId: string): Promise<any> {
  return store.deleteOne("models", modelId);
}

/**
 * Retrieves a model from the database by ID.
 *
 * @param modelId The ID of the model to retrieve.
 * @returns A promise that resolves with the model.
 */
function getModelById(modelId: string): Promise<any> {
  return store.findOne("models", modelId);
}

function onStart() {
  store.createCollection("models", {});
}

// Register all the above functions and objects with the relevant extension points
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);

  register(ModelManagementService.GetDownloadedModels, getDownloadedModels.name, getDownloadedModels);
  register(ModelManagementService.GetAvailableModels, getAvailableModels.name, getAvailableModels);
  register(ModelManagementService.DownloadModel, downloadModel.name, downloadModel);
  register(ModelManagementService.DeleteModel, deleteModel.name, deleteModel);
  register(ModelManagementService.SearchModels, searchModels.name, searchModels);
  register(ModelManagementService.GetConfiguredModels, getConfiguredModels.name, getConfiguredModels);

  register(ModelManagementService.StoreModel, storeModel.name, storeModel);
  register(ModelManagementService.UpdateFinishedDownloadAt, updateFinishedDownloadAt.name, updateFinishedDownloadAt);
  register(
    ModelManagementService.GetUnfinishedDownloadModels,
    getUnfinishedDownloadModels.name,
    getUnfinishedDownloadModels
  );
  register(ModelManagementService.DeleteDownloadModel, deleteDownloadModel.name, deleteDownloadModel);
  register(ModelManagementService.GetModelById, getModelById.name, getModelById);
  register(ModelManagementService.GetFinishedDownloadModels, getFinishedDownloadModels.name, getFinishedDownloadModels);
}
