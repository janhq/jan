import {
  ModelManagementService,
  PluginService,
  RegisterExtensionPoint,
  downloadFile,
  deleteFile,
  store,
} from "@janhq/core";
import { parseToModel } from "./helper";

const downloadModel = (product) => downloadFile(product.downloadUrl, product.fileName);

const deleteModel = (path) => deleteFile(path);

async function getConfiguredModels() {
  // Clear cache to get the latest model catalog
  delete require.cache[MODEL_CATALOG_URL];

  // Import the remote model catalog
  const module = require(MODEL_CATALOG_URL);
  return module.default.map((e) => {
    return parseToModel(e);
  });
}

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

  register(ModelManagementService.DownloadModel, downloadModel.name, downloadModel);
  register(ModelManagementService.DeleteModel, deleteModel.name, deleteModel);
  register(ModelManagementService.GetConfiguredModels, getConfiguredModels.name, getConfiguredModels);

  register(ModelManagementService.StoreModel, storeModel.name, storeModel);
  register(ModelManagementService.UpdateFinishedDownloadAt, updateFinishedDownloadAt.name, updateFinishedDownloadAt);

  register(ModelManagementService.DeleteDownloadModel, deleteDownloadModel.name, deleteDownloadModel);
  register(ModelManagementService.GetModelById, getModelById.name, getModelById);
  register(ModelManagementService.GetFinishedDownloadModels, getFinishedDownloadModels.name, getFinishedDownloadModels);
}
