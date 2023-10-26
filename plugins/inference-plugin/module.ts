const path = require("path");
const { app } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const tcpPortUsed = require("tcp-port-used");
const { killPortProcess } = require("kill-port-process");

const PORT = 3928;
let subprocess = null;

const initModel = (fileName) => {
  return (
    new Promise<void>(async (resolve, reject) => {
      if (!fileName) {
        reject("Model not found, please download again.");
      }
      resolve(fileName);
    })
      // Spawn Nitro subprocess to load model
      .then(() => {
        return tcpPortUsed.check(PORT, "127.0.0.1").then((inUse) => {
          if (!inUse) {
            let binaryFolder = path.join(__dirname, "nitro"); // Current directory by default
            let binaryName;

            if (process.platform === "win32") {
              // Todo: Need to check for CUDA support to switch between CUDA and non-CUDA binaries
              binaryName = "nitro_start_windows.bat";
            } else if (process.platform === "darwin") {
              // Mac OS platform
              binaryName =
                process.arch === "arm64"
                  ? "nitro_mac_arm64"
                  : "nitro_mac_intel";
            } else {
              // Linux
              // Todo: Need to check for CUDA support to switch between CUDA and non-CUDA binaries
              binaryName = "nitro_start_linux.sh"; // For other platforms
            }

            const binaryPath = path.join(binaryFolder, binaryName);

            // Execute the binary
            subprocess = spawn(binaryPath, { cwd: binaryFolder });

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
        });
      })
      .then(() => tcpPortUsed.waitUntilUsed(PORT, 300, 30000))
      .then(() => {
        const llama_model_path = path.join(app.getPath("userData"), fileName);

        const config = {
          llama_model_path,
          ctx_len: 2048,
          ngl: 100,
          embedding: true, // Always enable embedding mode on
        };

        // Load model config
        return fetch(`http://127.0.0.1:${PORT}/inferences/llamacpp/loadmodel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(config),
        });
      })
      .then((res) => {
        if (res.ok) {
          return {};
        }
        throw new Error("Nitro: Model failed to load.");
      })
      .catch((err) => {
        return { error: err };
      })
  );
};

function dispose() {
  killSubprocess();
  // clean other registered resources here
}

function killSubprocess() {
  if (subprocess) {
    subprocess.kill();
    subprocess = null;
    console.log("Subprocess terminated.");
  } else {
    killPortProcess(PORT);
    console.error("No subprocess is currently running.");
  }
}

module.exports = {
  initModel,
  killSubprocess,
  dispose,
};
