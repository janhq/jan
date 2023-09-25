// @ts-nocheck
import {
  app,
  BrowserWindow,
  screen as electronScreen,
  dialog,
  ipcMain,
} from "electron";
import { resolve, join } from "path";
import { readdirSync, createWriteStream, unlink, lstatSync } from "fs";

import isDev = require("electron-is-dev");
import request = require("request");

import { init, getStore } from "./core/plugin-manager/pluginMgr";
let modelSession = undefined;
let modelName = "llama-2-7b-chat.gguf.q4_0.bin";
let mainWindow;

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: electronScreen.getPrimaryDisplay().workArea.width,
    height: electronScreen.getPrimaryDisplay().workArea.height,
    show: false,
    backgroundColor: "white",
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  // TODO: add options for model configuration
  ipcMain.handle("initModel", async (event, product) => {
    if (!product.fileName) {
      await dialog.showMessageBox({
        message: "Selected model does not have file name..",
      });

      return;
    }

    console.info(`Initializing model: ${product.name}..`);
    import(
      isDev
        ? "../node_modules/node-llama-cpp/dist/index.js"
        : resolve(
            app.getAppPath(),
            "./../../app.asar.unpacked/node_modules/node-llama-cpp/dist/index.js"
          )
    )
      .then(({ LlamaContext, LlamaChatSession, LlamaModel }) => {
        const modelPath = join(app.getPath("userData"), product.fileName);
        // TODO: check if file is already there
        const model = new LlamaModel({
          modelPath: modelPath,
        });
        const context = new LlamaContext({ model });
        modelSession = new LlamaChatSession({ context });
        console.info(`Init model ${product.name} successfully!`);
      })
      .catch(async (e) => {
        await dialog.showMessageBox({
          message: "Failed to import LLM module",
        });
      });
  });

  ipcMain.handle("invokePluginFunc", async (event, plugin, method, ...args) => {
    const plg = getStore()
      .getActivePlugins()
      .filter((p) => p.name === plugin)[0];
    const pluginPath = join(
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
    : `file://${join(__dirname, "../out/index.html")}`;

  mainWindow.loadURL(startURL);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createMainWindow();
  setupPlugins();

  ipcMain.handle("userData", async (event) => {
    return join(__dirname, "../");
  });

  ipcMain.handle("downloadModel", async (event, url) => {
    const userDataPath = app.getPath("userData");
    const destination = resolve(userDataPath, modelName);

    progress(request(url), {})
      .on("progress", function (state) {
        mainWindow.webContents.send("model-download-update", {
          ...state,
          modelId: modelName,
        });
      })
      .on("error", function (err) {
        mainWindow.webContents.send("model-download-error", err);
      })
      .on("end", function () {
        app.relaunch();
        app.exit();
        // Do something after request finishes
      })
      .pipe(createWriteStream(destination));
  });

  ipcMain.handle("deleteModel", async (event, modelFileName) => {
    const userDataPath = app.getPath("userData");
    const fullPath = join(userDataPath, modelFileName);

    let result = "NULL";
    unlink(fullPath, function (err) {
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

  // TODO: add options for model configuration
  ipcMain.handle("initModel", async (event, product) => {
    if (!product.fileName) {
      await dialog.showMessageBox({
        message: "Selected model does not have file name..",
      });

      return;
    }

    console.info(`Initializing model: ${product.name}..`);
    import(
      isDev
        ? "../node_modules/node-llama-cpp/dist/index.js"
        : resolve(
            app.getAppPath(),
            "./../../app.asar.unpacked/node_modules/node-llama-cpp/dist/index.js"
          )
    )
      .then(({ LlamaContext, LlamaChatSession, LlamaModel }) => {
        const modelPath = join(app.getPath("userData"), product.fileName);
        // TODO: check if file is already there
        const model = new LlamaModel({
          modelPath: modelPath,
        });
        const context = new LlamaContext({ model });
        modelSession = new LlamaChatSession({ context });
        console.info(`Init model ${product.name} successfully!`);
      })
      .catch(async (e) => {
        await dialog.showMessageBox({
          message: "Failed to import LLM module",
        });
      });
  });

  ipcMain.handle("getDownloadedModels", async (event) => {
    const userDataPath = app.getPath("userData");

    const allBinariesName = [];
    var files = readdirSync(userDataPath);
    for (var i = 0; i < files.length; i++) {
      var filename = join(userDataPath, files[i]);
      var stat = lstatSync(filename);
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
  init({
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
    pluginsPath: join(app.getPath("userData"), "plugins"),
  });
}
