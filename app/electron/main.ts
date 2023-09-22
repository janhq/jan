// @ts-nocheck
const {
  app,
  BrowserWindow,
  screen: electronScreen,
  dialog,
  ipcMain,
} = require("electron");
const isDev = require("electron-is-dev");
const path = require("path");
const pe = require("pluggable-electron/main");
const fs = require("fs");
const { mkdir, writeFile } = require("fs/promises");
const { Readable } = require("stream");
const { finished } = require("stream/promises");
const request = require("request");

let modelSession = undefined;
let modelName = "llama-2-7b-chat.gguf.q4_0.bin";

let window;

const createMainWindow = () => {
  window = new BrowserWindow({
    width: electronScreen.getPrimaryDisplay().workArea.width,
    height: electronScreen.getPrimaryDisplay().workArea.height,
    show: false,
    backgroundColor: "white",
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      preload: path.resolve(app.getAppPath(), "electron/preload.js"),
    },
  });

  import(
    isDev
      ? "../node_modules/node-llama-cpp/dist/index.js"
      : path.resolve(
          app.getAppPath(),
          "./../../app.asar.unpacked/node_modules/node-llama-cpp/dist/index.js"
        )
  )
    .then(({ LlamaContext, LlamaChatSession, LlamaModel }) => {
      const modelPath = path.join(app.getPath("userData"), modelName);
      const model = new LlamaModel({
        modelPath: modelPath,
      });
      const context = new LlamaContext({ model });
      modelSession = new LlamaChatSession({ context });
    })
    .catch(async (e) => {
      await dialog.showMessageBox({
        message: "Failed to import LLM module",
      });
    });

  ipcMain.handle("invokePluginFunc", async (event, plugin, method, ...args) => {
    const plg = pe
      .getStore()
      .getActivePlugins()
      .filter((p) => p.name === plugin)[0];
    const pluginPath = path.join(
      app.getPath("userData"),
      "plugins",
      plg.name,
      "dist/module.js"
    );
    return await import(
      /* webpackIgnore: true */
      pluginPath
    )
      .then((plugin) => {
        if (typeof plugin[method] === "function") {
          return plugin[method](...args);
        } else {
          console.log(plugin[method]);
          console.error(`Function "${method}" does not exist in the module.`);
        }
      })
      .then((res) => {
        return res;
      })
      .catch((err) => console.log(err));
  });

  const startURL = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../out/index.html")}`;

  window.loadURL(startURL);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  window.webContents.openDevTools();
};

app.whenReady().then(() => {
  createMainWindow();
  setupPlugins();

  ipcMain.handle("userData", async (event) => {
    return path.resolve(__dirname, "../");
  });

  ipcMain.handle("downloadModel", async (event, url) => {
    const userDataPath = app.getPath("userData");
    const destination = path.resolve(userDataPath, modelName);

    progress(request(url), {})
      .on("progress", function (state) {
        window.webContents.send("model-download-update", {
          ...state,
          modelId: modelName,
        });
      })
      .on("error", function (err) {
        window.webContents.send("model-download-error", err);
      })
      .on("end", function () {
        app.relaunch();
        app.exit();
        // Do something after request finishes
      })
      .pipe(fs.createWriteStream(destination));
  });

  ipcMain.handle("deleteModel", async (event, modelFileName) => {
    const userDataPath = app.getPath("userData");
    const fullPath = path.join(userDataPath, modelFileName);

    let result = "NULL";
    fs.unlink(fullPath, function (err) {
      if (err && err.code == "ENOENT") {
        console.info("File doesn't exist, won't remove it.");
        result = "FILE_NOT_EXIST";
      } else if (err) {
        console.error("Error occurred while trying to remove file");
        result = "ERROR";
      } else {
        console.info(`removed`);
        result = "REMOVED";
      }
    });
    console.log(result);
    return result;
  });

  ipcMain.handle("getDownloadedModels", async (event) => {
    const userDataPath = app.getPath("userData");

    const allBinariesName = [];
    var files = fs.readdirSync(userDataPath);
    for (var i = 0; i < files.length; i++) {
      var filename = path.join(userDataPath, files[i]);
      var stat = fs.lstatSync(filename);
      if (stat.isDirectory()) {
        // ignore
      } else if (filename.endsWith(".bin")) {
        allBinariesName.push(filename);
      }
    }
    return allBinariesName;
  });

  ipcMain.handle("sendInquiry", async (event, question) => {
    if (!modelSession) {
      console.error("Model session has not been initialized!");
      return;
    }
    return modelSession.prompt(question);
  });

  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function setupPlugins() {
  pe.init({
    // Function to check from the main process that user wants to install a plugin
    confirmInstall: async (plugins) => {
      const answer = await dialog.showMessageBox({
        message: `Are you sure you want to install the plugin ${plugins.join(
          ", "
        )}`,
        buttons: ["Ok", "Cancel"],
        cancelId: 1,
      });
      return answer.response == 0;
    },
    // Path to install plugin to
    pluginsPath: path.join(app.getPath("userData"), "plugins"),
  });
}
