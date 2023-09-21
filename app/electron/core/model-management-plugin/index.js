const getDownloadedModels = async () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.getDownloadedModels();
      resolve(response);
    }
  });

const getAvailableModels = async () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.getAvailableModels();
      resolve(response);
    }
  });

// TODO: register callback for progress update
const downloadModel = async (url) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.downloadModel(url);
      resolve(response);
    }
  });

const deleteModel = async (path) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.deleteModel(path);
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
