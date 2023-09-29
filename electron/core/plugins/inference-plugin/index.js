const MODULE_PATH = "inference-plugin/dist/module.js";

const initModel = async (product) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "initModel", product)
        .then((res) => resolve(res));
    }
  });

const dispose = async () =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "killSubprocess")
        .then((res) => resolve(res));
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("initModel", "initModel", initModel);
  register("dispose", "dispose", dispose);
}
