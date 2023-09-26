const path = require("path");
const { app, dialog } = require("electron");
const isDev = require("electron-is-dev");
const _importDynamic = new Function("modulePath", "return import(modulePath)");

let llamaSession = null;

async function initModel(product) {
  if (!product.fileName) {
    await dialog.showMessageBox({
      message: "Selected model does not have file name..",
    });

    return;
  }

  console.info(`Initializing model: ${product.name}..`);
  _importDynamic(
    isDev
      ? path.join(__dirname, "../node_modules/node-llama-cpp/dist/index.js")
      : path.resolve(
          app.getAppPath(),
          "./../../app.asar.unpacked/node_modules/node-llama-cpp/dist/index.js"
        )
  )
    .then(({ LlamaContext, LlamaChatSession, LlamaModel }) => {
      const modelPath = path.join(app.getPath("userData"), product.fileName);
      const model = new LlamaModel({ modelPath });
      const context = new LlamaContext({ model });
      llamaSession = new LlamaChatSession({ context });
      console.info(`Init model ${product.name} successfully!`);
    })
    .catch(async (e) => {
      console.error(e);
      await dialog.showMessageBox({
        message: "Failed to import LLM module",
      });
    });
}

async function prompt(prompt) {
  if (!llamaSession) {
    await dialog.showMessageBox({
      message: "Model not initialized",
    });

    return;
  }

  const response = await llamaSession.prompt(prompt);
  return response;
}

module.exports = {
  initModel,
  prompt,
};
