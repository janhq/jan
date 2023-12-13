const fs = require("fs");
const kill = require("kill-port");
const path = require("path");
const { spawn } = require("child_process");
const tcpPortUsed = require("tcp-port-used");
const fetchRetry = require("fetch-retry")(global.fetch);
const si = require("systeminformation");

const log = require("electron-log");

// The PORT to use for the Nitro subprocess
const PORT = 3928;
const LOCAL_HOST = "127.0.0.1";
const NITRO_HTTP_SERVER_URL = `http://${LOCAL_HOST}:${PORT}`;
const NITRO_HTTP_LOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/loadmodel`;
const NITRO_HTTP_UNLOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/unloadModel`;
const NITRO_HTTP_VALIDATE_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/modelstatus`;
const NITRO_HTTP_KILL_URL = `${NITRO_HTTP_SERVER_URL}/processmanager/destroy`;

// The subprocess instance for Nitro
let subprocess = null;
let currentModelFile = null;

/**
 * Stops a Nitro subprocess.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
function stopModel(): Promise<ModelOperationResponse> {
  return new Promise((resolve, reject) => {
    checkAndUnloadNitro();
    resolve({ error: undefined });
  });
}

/**
 * Initializes a Nitro subprocess to load a machine learning model.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 * TODO: Should pass absolute of the model file instead of just the name - So we can modurize the module.ts to npm package
 * TODO: Should it be startModel instead?
 */
async function initModel(wrapper: any): Promise<ModelOperationResponse> {
  currentModelFile = wrapper.modelFullPath;
  if (wrapper.model.engine !== "nitro") {
    return Promise.resolve({ error: "Not a nitro model" });
  } else {
    // Gather system information for CPU physical cores and memory
    const nitroResourceProbe = await getResourcesInfo();

    // Convert settings.prompt_template to system_prompt, user_prompt, ai_prompt
    if (wrapper.model.settings.prompt_template) {
      const promptTemplate = wrapper.model.settings.prompt_template;
      const prompt = promptTemplateConverter(promptTemplate);
      if (prompt.error) {
        return Promise.resolve({ error: prompt.error });
      }
      wrapper.model.settings.system_prompt = prompt.system_prompt;
      wrapper.model.settings.user_prompt = prompt.user_prompt;
      wrapper.model.settings.ai_prompt = prompt.ai_prompt;
    }

    const settings = {
      llama_model_path: currentModelFile,
      ...wrapper.model.settings,
      // This is critical and requires real system information
      cpu_threads: nitroResourceProbe.numCpuPhysicalCore,
    };
    log.info(`Load model settings: ${JSON.stringify(settings, null, 2)}`);
    return (
      // 1. Check if the port is used, if used, attempt to unload model / kill nitro process
      validateModelVersion()
        .then(checkAndUnloadNitro)
        // 2. Spawn the Nitro subprocess
        .then(await spawnNitroProcess(nitroResourceProbe))
        // 4. Load the model into the Nitro subprocess (HTTP POST request)
        .then(() => loadLLMModel(settings))
        // 5. Check if the model is loaded successfully
        .then(validateModelStatus)
        .catch((err) => {
          log.error("error: " + JSON.stringify(err));
          return { error: err, currentModelFile };
        })
    );
  }
}

function promptTemplateConverter(promptTemplate) {
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
    const system_prompt = "";

    // Return the split parts
    return { system_prompt, user_prompt, ai_prompt };
  }

  // Return an error if none of the conditions are met
  return { error: "Cannot split prompt template" };
}

/**
 * Loads a LLM model into the Nitro subprocess by sending a HTTP POST request.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function loadLLMModel(settings): Promise<Response> {
  return fetchRetry(NITRO_HTTP_LOAD_MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
    retries: 3,
    retryDelay: 500,
  }).catch((err) => {
    console.error(err);
    log.error("error: " + JSON.stringify(err));
    // Fetch error, Nitro server might not started properly
    throw new Error("Model loading failed.");
  });
}

/**
 * Validates the status of a model.
 * @returns {Promise<ModelOperationResponse>} A promise that resolves to an object.
 * If the model is loaded successfully, the object is empty.
 * If the model is not loaded successfully, the object contains an error message.
 */
async function validateModelStatus(): Promise<ModelOperationResponse> {
  // Send a GET request to the validation URL.
  // Retry the request up to 3 times if it fails, with a delay of 500 milliseconds between retries.
  return fetchRetry(NITRO_HTTP_VALIDATE_MODEL_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    retries: 5,
    retryDelay: 500,
  })
    .then(async (res: Response) => {
      // If the response is OK, check model_loaded status.
      if (res.ok) {
        const body = await res.json();
        // If the model is loaded, return an empty object.
        // Otherwise, return an object with an error message.
        if (body.model_loaded) {
          return { error: undefined };
        }
      }
      return { error: "Model loading failed" };
    })
    .catch((err) => {
      log.error("Model loading failed" + err.toString());
      return { error: `Model loading failed.` };
    });
}

/**
 * Terminates the Nitro subprocess.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
function killSubprocess(): Promise<void> {
  fetch(NITRO_HTTP_KILL_URL, {
    method: "DELETE",
  }).catch((err) => {
    console.error(err);
    subprocess?.kill();
    kill(PORT, "tcp").then(console.log).catch(console.log);
    subprocess = null;
  });
  return
}

/**
 * Check port is used or not, if used, attempt to unload model
 * If unload failed, kill the port
 */
async function checkAndUnloadNitro() {
  return tcpPortUsed.check(PORT, LOCAL_HOST).then(async (inUse) => {
    // If inUse - try unload or kill process, otherwise do nothing
    if (inUse) {
      // Attempt to unload model
      return fetch(NITRO_HTTP_UNLOAD_MODEL_URL, {
        method: "GET",
      }).catch((err) => {
        console.error(err);
        // Fallback to kill the port
        return killSubprocess();
      });
    }
  });
}

/**
 * Look for the Nitro binary and execute it
 * Using child-process to spawn the process
 * Should run exactly platform specified Nitro binary version
 */
async function spawnNitroProcess(nitroResourceProbe: any): Promise<any> {
  return new Promise(async (resolve, reject) => {
    let binaryFolder = path.join(__dirname, "bin"); // Current directory by default
    let binaryName;

    if (process.platform === "win32") {
      binaryName = "win-start.bat";
    } else if (process.platform === "darwin") {
      if (process.arch === "arm64") {
        binaryFolder = path.join(binaryFolder, "mac-arm64");
      } else {
        binaryFolder = path.join(binaryFolder, "mac-x64");
      }
      binaryName = "nitro";
    } else {
      binaryName = "linux-start.sh";
    }

    const binaryPath = path.join(binaryFolder, binaryName);

    // Execute the binary
    subprocess = spawn(binaryPath, [1, LOCAL_HOST, PORT], {
      cwd: binaryFolder,
    });

    // Handle subprocess output
    subprocess.stdout.on("data", (data) => {
      console.debug(`stdout: ${data}`);
    });

    subprocess.stderr.on("data", (data) => {
      log.error("subprocess error:" + data.toString());
      console.error(`stderr: ${data}`);
    });

    subprocess.on("close", (code) => {
      console.debug(`child process exited with code ${code}`);
      subprocess = null;
      reject(`Nitro process exited. ${code ?? ""}`);
    });
    tcpPortUsed.waitUntilUsed(PORT, 300, 30000).then(() => {
      resolve(nitroResourceProbe);
    });
  });
}

/**
 * Validate the model version, if it is GGUFv1, reject the promise
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function validateModelVersion(): Promise<void> {
  log.info("validateModelVersion");
  // Read the file
  return new Promise((resolve, reject) => {
    fs.open(currentModelFile, "r", (err, fd) => {
      if (err) {
        log.error("validateModelVersion error" + JSON.stringify(err));
        console.error(err.message);
        reject(err);
        return;
      }

      // Buffer to store the byte
      const buffer = Buffer.alloc(1);

      // Model version will be the 5th byte of the file
      fs.read(fd, buffer, 0, 1, 4, (err, bytesRead, buffer) => {
        if (err) {
          log.error("validateModelVersion open error" + JSON.stringify(err));
          console.error(err.message);
          fs.close(fd, (err) => {
            log.error("validateModelVersion close error" + JSON.stringify(err));
            if (err) console.error(err.message);
          });
          reject(err);
        } else {
          // Interpret the byte as ASCII
          if (buffer[0] === 0x01) {
            // This is GGUFv1, which is deprecated
            reject("GGUFv1 model is deprecated, please try another model.");
          }
        }

        // Close the file descriptor
        fs.close(fd, (err) => {
          if (err) console.error(err.message);
        });
        resolve();
      });
    });
  });
}

function dispose() {
  // clean other registered resources here
  killSubprocess();
}

/**
 * Get the system resources information
 */
async function getResourcesInfo(): Promise<ResourcesInfo> {
  return new Promise(async (resolve) => {
    const cpu = await si.cpu();
    const mem = await si.mem();

    const response = {
      numCpuPhysicalCore: cpu.physicalCores,
      memAvailable: mem.available,
    };
    resolve(response);
  });
}

module.exports = {
  initModel,
  stopModel,
  killSubprocess,
  dispose,
};
