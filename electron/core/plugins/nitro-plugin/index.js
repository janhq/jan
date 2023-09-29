const MODULE_PATH = "nitro-plugin/dist/module.js";

const installModel = async (product) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "installModel", product)
        .then((res) => resolve(res));
    }
});

const uninstallModel = async (product) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      window.electronAPI
        .invokePluginFunc(MODULE_PATH, "uninstallModel", product)
        .then((res) => resolve(res));
    }
});

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("installModel", "installModel", installModel);
  register("uninstallModel", "uninstallModel", uninstallModel);
}
