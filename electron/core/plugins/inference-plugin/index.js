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
        .invokePluginFunc(MODULE_PATH, "dispose")
        .then((res) => resolve(res));
    }
  });
const inferenceUrl = () => "http://localhost:8080/llama/chat_completion";

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("initModel", "initModel", initModel);
  register("inferenceUrl", "inferenceUrl", inferenceUrl);
  register("dispose", "dispose", dispose);
}
