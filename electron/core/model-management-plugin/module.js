const path = require("path");
const { readdirSync, lstatSync } = require("fs");
const { app } = require("electron");

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
