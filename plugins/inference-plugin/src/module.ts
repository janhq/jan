const fs = require("fs");
const kill = require("kill-port");
const path = require("path");
const { app } = require("electron");
const { spawn } = require("child_process");
const tcpPortUsed = require("tcp-port-used");

// The PORT to use for the Nitro subprocess
const PORT = 3928;
const LOCAL_HOST = "127.0.0.1";
const NITRO_HTTP_SERVER_URL = `http://${LOCAL_HOST}:${PORT}`;
const NITRO_HTTP_LOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/loadmodel`;
const NITRO_HTTP_UNLOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/unloadModel`;

// The subprocess instance for Nitro
let subprocess = null;

/**
 * The response from the initModel function.
 * @property error - An error message if the model fails to load.
 */
interface InitModelResponse {
  error?: any;
}

/**
 * Initializes a Nitro subprocess to load a machine learning model.
 * @param fileName - The name of the machine learning model file.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 * TODO: Should pass absolute of the model file instead of just the name - So we can modurize the module.ts to npm package
 */
function initModel(fileName: string): Promise<InitModelResponse> {
  // 1. Check if the model file exists
  return (
    checkModelFileExist(fileName)
      // 2. Check if the port is used, if used, attempt to unload model / kill nitro process
      .then(checkAndUnloadNitro)
      // 3. Spawn the Nitro subprocess
      .then(spawnNitroProcess)
      // 4. Wait until the port is used (Nitro http server is up)
      .then(() => tcpPortUsed.waitUntilUsed(PORT, 300, 30000))
      // 5. Load the model into the Nitro subprocess (HTTP POST request)
      .then(() => loadLLMModel(fileName))
      // 6. Check if the model is loaded successfully
      .then(async (res) => {
        if (res.ok) {
          return {};
        }
        const json = await res.json();
        throw new Error(`Nitro: Model failed to load. ${json}`);
      })
      .catch((err) => {
        return { error: err };
      })
  );
}

/**
 * Loads a LLM model into the Nitro subprocess by sending a HTTP POST request.
 * @param fileName - The name of the model file.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function loadLLMModel(fileName: string): Promise<Response> {
  const llama_model_path = path.join(appPath(), fileName);

  const config = {
    llama_model_path,
    ctx_len: 2048,
    ngl: 100,
    embedding: false, // Always enable embedding mode on
  };

  // Load model config
  return fetch(NITRO_HTTP_LOAD_MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
}

/**
 * Checks if the model file exists.
 * @param fileName - The name of the model file.
 * @returns A Promise that resolves when the model file exists, or rejects with an error message if the model file does not exist.
 */
function checkModelFileExist(fileName: string): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    if (!fileName) {
      reject("Model not found, please download again.");
    }
    resolve(fileName);
  });
}

/**
 * Terminates the Nitro subprocess.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
function killSubprocess(): Promise<void> {
  if (subprocess) {
    subprocess.kill();
    subprocess = null;
    console.log("Subprocess terminated.");
  } else {
    return kill(PORT, "tcp").then(console.log).catch(console.log);
  }
}

/**
 * Returns the path to the user data directory.
 * @returns The path to the user data directory.
 */
function appPath() {
  return app.getPath("userData");
}

/**
 * Check port is used or not, if used, attempt to unload model
 * If unload failed, kill the port
 */
function checkAndUnloadNitro() {
  return tcpPortUsed.check(PORT, LOCAL_HOST).then((inUse) => {
    // If inUse - try unload or kill process, otherwise do nothing
    if (inUse) {
      // Attempt to unload model
      return fetch(NITRO_HTTP_UNLOAD_MODEL_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }).catch((err) => {
        console.log(err);
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
function spawnNitroProcess() {
  let binaryFolder = path.join(__dirname, "nitro"); // Current directory by default
  let binaryName;

  if (process.platform === "win32") {
    // Todo: Need to check for CUDA support to switch between CUDA and non-CUDA binaries
    binaryName = "win-start.bat";
  } else if (process.platform === "darwin") {
    // Mac OS platform
    if (process.arch === "arm64") {
      binaryFolder = path.join(binaryFolder, "mac-arm64");
    } else {
      binaryFolder = path.join(binaryFolder, "mac-x64");
    }
    binaryName = "nitro";
  } else {
    // Linux
    // Todo: Need to check for CUDA support to switch between CUDA and non-CUDA binaries
    binaryName = "linux-start.sh"; // For other platforms
  }

  const binaryPath = path.join(binaryFolder, binaryName);

  // Execute the binary
  subprocess = spawn(binaryPath, [1, "0.0.0.0", PORT], {
    cwd: binaryFolder,
  });

  // Handle subprocess output
  subprocess.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  subprocess.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  subprocess.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
    subprocess = null;
  });
}

/**
 * Cleans up any registered resources.
 * Its module specific function, should be called when application is closed
 */
function dispose() {
  // clean other registered resources here
  killSubprocess();
}

module.exports = {
  initModel,
  killSubprocess,
  dispose,
};
