const path = require("path");
const { app, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");

let subprocess = null;

process.on("exit", () => {
  // Perform cleanup tasks here
  console.log("kill subprocess on exit");
  if (subprocess) {
    subprocess.kill();
  }
});

async function initModel(product) {
  // fileName fallback
  if (!product.fileName) {
    product.fileName = product.file_name;
  }

  if (!product.fileName) {
    await dialog.showMessageBox({
      message: "Selected model does not have file name..",
    });

    return;
  }

  if (subprocess) {
    console.error(
      "A subprocess is already running. Attempt to kill then reinit."
    );
    killSubprocess();
  }

  let binaryFolder = path.join(__dirname, "nitro"); // Current directory by default

  // Read the existing config
  const configFilePath = `${binaryFolder}/config/config.json`;
  let config = {};
  if (fs.existsSync(configFilePath)) {
    const rawData = fs.readFileSync(configFilePath, "utf-8");
    config = JSON.parse(rawData);
  }

  // Update the llama_model_path
  if (!config.custom_config) {
    config.custom_config = {};
  }

  const modelPath = path.join(app.getPath("userData"), product.fileName);

  config.custom_config.llama_model_path = modelPath;

  // Write the updated config back to the file
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 4));

  const binaryPath =
    process.platform === "win32"
      ? path.join(binaryFolder, "nitro.exe")
      : path.join(binaryFolder, "nitro");
  // Execute the binary
  console.log("spawn nitro subprocess at: " + binaryPath);
  subprocess = spawn(binaryPath, [configFilePath]);

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

function killSubprocess() {
  if (subprocess) {
    subprocess.kill();
    subprocess = null;
    console.log("Subprocess terminated.");
  } else {
    console.error("No subprocess is currently running.");
  }
}

module.exports = {
  initModel,
  killSubprocess,
};
