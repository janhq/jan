const MODULE_PATH = "model-management-plugin/dist/module.js";

const getDownloadedModels = () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getDownloadedModels")
        .then((res) => resolve(res));
    }
  });

const getAvailableModels = () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getAvailableModels")
        .then((res) => resolve(res));
    }
  });

const downloadModel = (product) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .downloadFile(product.downloadUrl, product.fileName)
        .then((res) => resolve(res));
    } else {
      resolve("-");
    }
  });

const deleteModel = (path) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      console.debug(`Delete model model management plugin: ${path}`);
      const response = await window.electronAPI.deleteFile(path);
      resolve(response);
    }
  });

const searchModels = (params) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "searchModels", params)
        .then((res) => resolve(res));
    }
  });

const getConfiguredModels = () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getConfiguredModels")
        .then((res) => resolve(res));
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("getDownloadedModels", "getDownloadedModels", getDownloadedModels);
  register("getAvailableModels", "getAvailableModels", getAvailableModels);
  register("downloadModel", "downloadModel", downloadModel);
  register("deleteModel", "deleteModel", deleteModel);
  register("searchModels", "searchModels", searchModels);
  register("getConfiguredModels", "getConfiguredModels", getConfiguredModels);
}
