// @ts-nocheck
import {
  app,
  BrowserWindow,
  screen as electronScreen,
  dialog,
  ipcMain,
} from "electron";
import { resolve, join } from "path";
import { unlink, createWriteStream } from "fs";
import isDev = require("electron-is-dev");
import { init } from "./core/plugin-manager/pluginMgr";
import request = require("request");
import progress = require("request-progress");

let modelSession = undefined;
let mainWindow;

const _importDynamic = new Function("modulePath", "return import(modulePath)");
const lastInitializedModel: string | undefined = undefined;

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

    if (lastInitializedModel === product.name) {
      console.log("Model initialized");
      return;
    }
    console.info(`Initializing model: ${product.name}..`);
    _importDynamic(
      isDev
        ? join(__dirname, "../node_modules/node-llama-cpp/dist/index.js")
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
        lastInitializedModel = product.name;
      })
      .catch(async (e) => {
        console.error(e);
        await dialog.showMessageBox({
          message: "Failed to import LLM module",
        });
      });
  });

  ipcMain.handle(
    "invokePluginFunc",
    async (event, modulePath, method, ...args) => {
      const module = join(app.getPath("userData"), "plugins", modulePath);
      return await import(/* webpackIgnore: true */ module)
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
    }
  );

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

  ipcMain.handle("pluginPath", async (event) => {
    return join(app.getPath("userData"), "plugins");
  });

  /**
   * Used to delete a file from the user data folder
   */
  ipcMain.handle("deleteFile", async (_event, filePath) => {
    const userDataPath = app.getPath("userData");
    const fullPath = join(userDataPath, filePath);

    let result = "NULL";
    unlink(fullPath, function (err) {
      if (err && err.code == "ENOENT") {
        result = `File not exist: ${err}`;
      } else if (err) {
        result = `File delete error: ${err}`;
      } else {
        result = "File deleted successfully";
      }
      console.log(`Delete file ${filePath} from ${fullPath} result: ${result}`);
    });

    return result;
  });

  /**
   * Used to download a file from a given url
   */
  ipcMain.handle("downloadFile", async (_event, url, fileName) => {
    const userDataPath = app.getPath("userData");
    const destination = resolve(userDataPath, fileName);

    progress(request(url), {})
      .on("progress", function (state) {
        mainWindow.webContents.send("FILE_DOWNLOAD_UPDATE", {
          ...state,
          fileName,
        });
      })
      .on("error", function (err) {
        mainWindow.webContents.send("FILE_DOWNLOAD_ERROR", {
          fileName,
          err,
        });
      })
      .on("end", function () {
        mainWindow.webContents.send("FILE_DOWNLOAD_COMPLETE", {
          fileName,
        });
      })
      .pipe(createWriteStream(destination));
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
