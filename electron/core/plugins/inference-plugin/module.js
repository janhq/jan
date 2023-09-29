const path = require("path");
const { app, dialog } = require("electron");
const _importDynamic = new Function("modulePath", "return import(modulePath)");

let llamaSession = null;

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

  console.info(`Initializing model: ${product.name}..`);
  _importDynamic("../node_modules/node-llama-cpp/dist/index.js")
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
  console.log("prompt: ", prompt);
  const response = await llamaSession.prompt(prompt);
  console.log("response: ", response);
  return response;
}

module.exports = {
  initModel,
  prompt,
};
