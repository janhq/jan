const MODULE_PATH = "model-management-plugin/dist/module.js";

const getDownloadedModels = async () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getDownloadedModels")
        .then((res) => resolve(res));
    }
  });

const getAvailableModels = async () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "getAvailableModels")
        .then((res) => resolve(res));
    }
  });

const downloadModel = async (product) =>
  new Promise(async (resolve) => {
    if (window && window.electronAPI) {
      window.electronAPI
        .downloadFile(product.downloadUrl, product.fileName)
        .then((res) => resolve(res));
    } else {
      resolve("-");
    }
  });

const deleteModel = async (path) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      console.debug(`Delete model model management plugin: ${path}`);
      const response = await window.electronAPI.deleteFile(path);
      resolve(response);
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("getDownloadedModels", "getDownloadedModels", getDownloadedModels);
  register("getAvailableModels", "getAvailableModels", getAvailableModels);
  register("downloadModel", "downloadModel", downloadModel);
  register("deleteModel", "deleteModel", deleteModel);
}
