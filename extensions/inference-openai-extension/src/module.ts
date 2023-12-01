const fetchRetry = require("fetch-retry")(global.fetch);

const log = require("electron-log");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * The response from the initModel function.
 * @property error - An error message if the model fails to load.
 */
interface InitModelResponse {
  error?: any;
  modelFile?: string;
}
// /root/engine/nitro.json

/**
 * Initializes a Nitro subprocess to load a machine learning model.
 * @param modelFile - The name of the machine learning model file.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function initModel(wrapper: any): Promise<InitModelResponse> {
  const engine_settings = {
    ...wrapper.settings,
  };

  return (
  )
}

module.exports = {
  initModel,
};
