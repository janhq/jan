const path = require("path");
const { readdirSync, lstatSync } = require("fs");
const { app } = require("electron");

// async function initModel(product) {
//   if (!product.fileName) {
//     await dialog.showMessageBox({
//       message: "Selected model does not have file name..",
//     });

//     return;
//   }

//   if (lastInitializedModel === product.name) {
//     console.log("Model initialized");
//     return;
//   }
//   console.info(`Initializing model: ${product.name}..`);
//   _importDynamic(
//     isDev
//       ? join(__dirname, "../node_modules/node-llama-cpp/dist/index.js")
//       : resolve(
//           app.getAppPath(),
//           "./../../app.asar.unpacked/node_modules/node-llama-cpp/dist/index.js"
//         )
//   )
//     .then(({ LlamaContext, LlamaChatSession, LlamaModel }) => {
//       const modelPath = join(app.getPath("userData"), product.fileName);
//       // TODO: check if file is already there
//       const model = new LlamaModel({
//         modelPath: modelPath,
//       });
//       const context = new LlamaContext({ model });
//       modelSession = new LlamaChatSession({ context });
//       console.info(`Init model ${product.name} successfully!`);
//       lastInitializedModel = product.name;
//     })
//     .catch(async (e) => {
//       console.error(e);
//       await dialog.showMessageBox({
//         message: "Failed to import LLM module",
//       });
//     });
// }

const ALL_MODELS = [
  {
    id: "llama-2-7b-chat.gguf.q4_0",
    slug: "llama-2-7b-chat.gguf.q4_0",
    name: "Llama 2 7B Chat - GGML",
    description: "my description",
    avatarUrl: "",
    longDescription: "my long description",
    technicalDescription: "my technical description",
    author: "The Bloke",
    version: "1.0.0",
    modelUrl: "https://google.com",
    nsfw: false,
    greeting: "Hello there",
    type: "LLM",
    inputs: undefined,
    outputs: undefined,
    createdAt: 0,
    updatedAt: undefined,
    fileName: "llama-2-7b-chat.gguf.q4_0.bin",
    downloadUrl:
      "https://huggingface.co/TheBloke/Llama-2-7b-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_0.gguf",
  },
];

function getDownloadedModels() {
  const userDataPath = app.getPath("userData");

  const allBinariesName = [];
  var files = readdirSync(userDataPath);
  for (var i = 0; i < files.length; i++) {
    var filename = path.join(userDataPath, files[i]);
    var stat = lstatSync(filename);
    if (stat.isDirectory()) {
      // ignore
    } else if (filename.endsWith(".bin")) {
      var binaryName = path.basename(filename);
      allBinariesName.push(binaryName);
    }
  }

  const downloadedModels = ALL_MODELS.map((model) => {
    if (model.fileName && allBinariesName.includes(model.fileName)) {
      return model;
    }
  });

  return downloadedModels;
}

function getAvailableModels() {
  const downloadedModelIds = getDownloadedModels().map((model) => model.id);
  return ALL_MODELS.filter((model) => {
    if (!downloadedModelIds.includes(model.id)) {
      return model;
    }
  });
}

module.exports = {
  getDownloadedModels,
  getAvailableModels,
};
