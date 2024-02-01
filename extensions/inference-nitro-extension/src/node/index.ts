import fs from "fs";
import path from "path";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import tcpPortUsed from "tcp-port-used";
import fetchRT from "fetch-retry";
import {
  log,
  getJanDataFolderPath,
  getSystemResourceInfo,
} from "@janhq/core/node";
import { getNitroProcessInfo, updateNvidiaInfo } from "./nvidia";
import {
  Model,
  InferenceEngine,
  ModelSettingParams,
  PromptTemplate,
} from "@janhq/core";
import { executableNitroFile } from "./execute";

// Polyfill fetch with retry
const fetchRetry = fetchRT(fetch);

/**
 * The response object for model init operation.
 */
interface ModelInitOptions {
  modelFullPath: string;
  model: Model;
}

/**
 * Model setting args for Nitro model load.
 */
interface ModelSettingArgs extends ModelSettingParams {
  llama_model_path: string;
  cpu_threads: number;
}

// The PORT to use for the Nitro subprocess
const PORT = 3928;
// The HOST address to use for the Nitro subprocess
const LOCAL_HOST = "127.0.0.1";
// The URL for the Nitro subprocess
const NITRO_HTTP_SERVER_URL = `http://${LOCAL_HOST}:${PORT}`;
// The URL for the Nitro subprocess to load a model
const NITRO_HTTP_LOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/loadmodel`;
// The URL for the Nitro subprocess to validate a model
const NITRO_HTTP_VALIDATE_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/modelstatus`;
// The URL for the Nitro subprocess to kill itself
const NITRO_HTTP_KILL_URL = `${NITRO_HTTP_SERVER_URL}/processmanager/destroy`;

// The supported model format
// TODO: Should be an array to support more models
const SUPPORTED_MODEL_FORMAT = ".gguf";

// The subprocess instance for Nitro
let subprocess: ChildProcessWithoutNullStreams | undefined = undefined;
// The current model file url
let currentModelFile: string = "";
// The current model settings
let currentSettings: ModelSettingArgs | undefined = undefined;

/**
 * Stops a Nitro subprocess.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
function stopModel(): Promise<void> {
  return killSubprocess();
}

/**
 * Initializes a Nitro subprocess to load a machine learning model.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 * TODO: Should pass absolute of the model file instead of just the name - So we can modurize the module.ts to npm package
 */
async function runModel(
  wrapper: ModelInitOptions
): Promise<ModelOperationResponse | void> {
  if (wrapper.model.engine !== InferenceEngine.nitro) {
    // Not a nitro model
    return Promise.resolve();
  }

  currentModelFile = wrapper.modelFullPath;
  const janRoot = await getJanDataFolderPath();
  if (!currentModelFile.includes(janRoot)) {
    currentModelFile = path.join(janRoot, currentModelFile);
  }
  const files: string[] = fs.readdirSync(currentModelFile);

  // Look for GGUF model file
  const ggufBinFile = files.find(
    (file) =>
      file === path.basename(currentModelFile) ||
      file.toLowerCase().includes(SUPPORTED_MODEL_FORMAT)
  );

  if (!ggufBinFile) return Promise.reject("No GGUF model file found");

  currentModelFile = path.join(currentModelFile, ggufBinFile);

  if (wrapper.model.engine !== InferenceEngine.nitro) {
    return Promise.reject("Not a nitro model");
  } else {
    const nitroResourceProbe = await getSystemResourceInfo();
    // Convert settings.prompt_template to system_prompt, user_prompt, ai_prompt
    if (wrapper.model.settings.prompt_template) {
      const promptTemplate = wrapper.model.settings.prompt_template;
      const prompt = promptTemplateConverter(promptTemplate);
      if (prompt?.error) {
        return Promise.reject(prompt.error);
      }
      wrapper.model.settings.system_prompt = prompt.system_prompt;
      wrapper.model.settings.user_prompt = prompt.user_prompt;
      wrapper.model.settings.ai_prompt = prompt.ai_prompt;
    }

    const modelFolderPath = path.join(janRoot, "models", wrapper.model.id);
    const modelPath = wrapper.model.settings.llama_model_path
      ? path.join(modelFolderPath, wrapper.model.settings.llama_model_path)
      : currentModelFile;

    currentSettings = {
      ...wrapper.model.settings,
      llama_model_path: modelPath,
      // This is critical and requires real CPU physical core count (or performance core)
      cpu_threads: Math.max(1, nitroResourceProbe.numCpuPhysicalCore),
      ...(wrapper.model.settings.mmproj && {
        mmproj: path.join(modelFolderPath, wrapper.model.settings.mmproj),
      }),
    };
    return runNitroAndLoadModel();
  }
}

/**
 * 1. Spawn Nitro process
 * 2. Load model into Nitro subprocess
 * 3. Validate model status
 * @returns
 */
async function runNitroAndLoadModel() {
  // Gather system information for CPU physical cores and memory
  return killSubprocess()
    .then(() => tcpPortUsed.waitUntilFree(PORT, 300, 5000))
    .then(() => {
      /**
       * There is a problem with Windows process manager
       * Should wait for awhile to make sure the port is free and subprocess is killed
       * The tested threshold is 500ms
       **/
      if (process.platform === "win32") {
        return new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        return Promise.resolve();
      }
    })
    .then(spawnNitroProcess)
    .then(() => loadLLMModel(currentSettings))
    .then(validateModelStatus)
    .catch((err) => {
      // TODO: Broadcast error so app could display proper error message
      log(`[NITRO]::Error: ${err}`);
      return { error: err };
    });
}

/**
 * Parse prompt template into agrs settings
 * @param promptTemplate Template as string
 * @returns
 */
function promptTemplateConverter(promptTemplate: string): PromptTemplate {
  // Split the string using the markers
  const systemMarker = "{system_message}";
  const promptMarker = "{prompt}";

  if (
    promptTemplate.includes(systemMarker) &&
    promptTemplate.includes(promptMarker)
  ) {
    // Find the indices of the markers
    const systemIndex = promptTemplate.indexOf(systemMarker);
    const promptIndex = promptTemplate.indexOf(promptMarker);

    // Extract the parts of the string
    const system_prompt = promptTemplate.substring(0, systemIndex);
    const user_prompt = promptTemplate.substring(
      systemIndex + systemMarker.length,
      promptIndex
    );
    const ai_prompt = promptTemplate.substring(
      promptIndex + promptMarker.length
    );

    // Return the split parts
    return { system_prompt, user_prompt, ai_prompt };
  } else if (promptTemplate.includes(promptMarker)) {
    // Extract the parts of the string for the case where only promptMarker is present
    const promptIndex = promptTemplate.indexOf(promptMarker);
    const user_prompt = promptTemplate.substring(0, promptIndex);
    const ai_prompt = promptTemplate.substring(
      promptIndex + promptMarker.length
    );

    // Return the split parts
    return { user_prompt, ai_prompt };
  }

  // Return an error if none of the conditions are met
  return { error: "Cannot split prompt template" };
}

/**
 * Loads a LLM model into the Nitro subprocess by sending a HTTP POST request.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function loadLLMModel(settings: any): Promise<Response> {
  log(`[NITRO]::Debug: Loading model with params ${JSON.stringify(settings)}`);
  return fetchRetry(NITRO_HTTP_LOAD_MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
    retries: 3,
    retryDelay: 500,
  })
    .then((res) => {
      log(
        `[NITRO]::Debug: Load model success with response ${JSON.stringify(
          res
        )}`
      );
      return Promise.resolve(res);
    })
    .catch((err) => {
      log(`[NITRO]::Error: Load model failed with error ${err}`);
      return Promise.reject();
    });
}

/**
 * Validates the status of a model.
 * @returns {Promise<ModelOperationResponse>} A promise that resolves to an object.
 * If the model is loaded successfully, the object is empty.
 * If the model is not loaded successfully, the object contains an error message.
 */
async function validateModelStatus(): Promise<void> {
  // Send a GET request to the validation URL.
  // Retry the request up to 3 times if it fails, with a delay of 500 milliseconds between retries.
  return fetchRetry(NITRO_HTTP_VALIDATE_MODEL_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    retries: 5,
    retryDelay: 500,
  }).then(async (res: Response) => {
    log(
      `[NITRO]::Debug: Validate model state success with response ${JSON.stringify(
        res
      )}`
    );
    // If the response is OK, check model_loaded status.
    if (res.ok) {
      const body = await res.json();
      // If the model is loaded, return an empty object.
      // Otherwise, return an object with an error message.
      if (body.model_loaded) {
        return Promise.resolve();
      }
    }
    return Promise.reject("Validate model status failed");
  });
}

/**
 * Terminates the Nitro subprocess.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
async function killSubprocess(): Promise<void> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);
  log(`[NITRO]::Debug: Request to kill Nitro`);

  return fetch(NITRO_HTTP_KILL_URL, {
    method: "DELETE",
    signal: controller.signal,
  })
    .then(() => {
      subprocess?.kill();
      subprocess = undefined;
    })
    .catch(() => {})
    .then(() => tcpPortUsed.waitUntilFree(PORT, 300, 5000))
    .then(() => log(`[NITRO]::Debug: Nitro process is terminated`));
}

/**
 * Spawns a Nitro subprocess.
 * @returns A promise that resolves when the Nitro subprocess is started.
 */
function spawnNitroProcess(): Promise<any> {
  log(`[NITRO]::Debug: Spawning Nitro subprocess...`);

  return new Promise<void>(async (resolve, reject) => {
    let binaryFolder = path.join(__dirname, "..", "bin"); // Current directory by default
    let executableOptions = executableNitroFile();

    const args: string[] = ["1", LOCAL_HOST, PORT.toString()];
    // Execute the binary
    log(
      `[NITRO]::Debug: Spawn nitro at path: ${executableOptions.executablePath}, and args: ${args}`
    );
    subprocess = spawn(
      executableOptions.executablePath,
      ["1", LOCAL_HOST, PORT.toString()],
      {
        cwd: binaryFolder,
        env: {
          ...process.env,
          CUDA_VISIBLE_DEVICES: executableOptions.cudaVisibleDevices,
        },
      }
    );

    // Handle subprocess output
    subprocess.stdout.on("data", (data: any) => {
      log(`[NITRO]::Debug: ${data}`);
    });

    subprocess.stderr.on("data", (data: any) => {
      log(`[NITRO]::Error: ${data}`);
    });

    subprocess.on("close", (code: any) => {
      log(`[NITRO]::Debug: Nitro exited with code: ${code}`);
      subprocess = undefined;
      reject(`child process exited with code ${code}`);
    });

    tcpPortUsed.waitUntilUsed(PORT, 300, 30000).then(() => {
      log(`[NITRO]::Debug: Nitro is ready`);
      resolve();
    });
  });
}

/**
 * Every module should have a dispose function
 * This will be called when the extension is unloaded and should clean up any resources
 * Also called when app is closed
 */
function dispose() {
  // clean other registered resources here
  killSubprocess();
}

export default {
  runModel,
  stopModel,
  killSubprocess,
  dispose,
  updateNvidiaInfo,
  getCurrentNitroProcessInfo: () => getNitroProcessInfo(subprocess),
};
