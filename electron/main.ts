import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { readdirSync } from "fs";
import { resolve, join, extname } from "path";
import { rmdir, unlink, createWriteStream } from "fs";
import { init } from "./core/plugin-manager/pluginMgr";
import { setupMenu } from "./utils/menu";
import { dispose } from "./utils/disposable";

const request = require("request");
const progress = require("request-progress");
const { autoUpdater } = require("electron-updater");
const Store = require("electron-store");

const requiredModules: Record<string, any> = {};
let mainWindow: BrowserWindow | undefined = undefined;

app
  .whenReady()
  .then(migratePlugins)
  .then(setupPlugins)
  .then(setupMenu)
  .then(handleIPCs)
  .then(handleAppUpdates)
  .then(createMainWindow)
  .then(() => {
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) {
        createMainWindow();
      }
    });
  });

app.on("window-all-closed", () => {
  dispose(requiredModules);
  app.quit();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "white",
    webPreferences: {
      nodeIntegration: true,
      preload: join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });

  const startURL = app.isPackaged
    ? `file://${join(__dirname, "../renderer/index.html")}`
    : "http://localhost:3000";

  mainWindow.loadURL(startURL);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  if (!app.isPackaged) mainWindow.webContents.openDevTools();
}

function handleAppUpdates() {
  /*New Update Available*/
  autoUpdater.on("update-available", async (_info: any) => {
    const action = await dialog.showMessageBox({
      message: `Update available. Do you want to download the latest update?`,
      buttons: ["Download", "Later"],
    });
    if (action.response === 0) await autoUpdater.downloadUpdate();
  });

  /*App Update Completion Message*/
  autoUpdater.on("update-downloaded", async (_info: any) => {
    mainWindow?.webContents.send("APP_UPDATE_COMPLETE", {});
    const action = await dialog.showMessageBox({
      message: `Update downloaded. Please restart the application to apply the updates.`,
      buttons: ["Restart", "Later"],
    });
    if (action.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  /*App Update Error */
  autoUpdater.on("error", (info: any) => {
    dialog.showMessageBox({ message: info.message });
    mainWindow?.webContents.send("APP_UPDATE_ERROR", {});
  });

  /*App Update Progress */
  autoUpdater.on("download-progress", (progress: any) => {
    console.log("app update progress: ", progress.percent);
    mainWindow?.webContents.send("APP_UPDATE_PROGRESS", {
      percent: progress.percent,
    });
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdates();
}

function handleIPCs() {
  ipcMain.handle(
    "invokePluginFunc",
    async (_event, modulePath, method, ...args) => {
      const module = require(/* webpackIgnore: true */ join(
        app.getPath("userData"),
        "plugins",
        modulePath
      ));
      requiredModules[modulePath] = module;

      if (typeof module[method] === "function") {
        return module[method](...args);
      } else {
        console.log(module[method]);
        console.error(`Function "${method}" does not exist in the module.`);
      }
    }
  );

  ipcMain.handle("basePlugins", async (_event) => {
    const basePluginPath = join(
      __dirname,
      "../",
      app.isPackaged
        ? "../app.asar.unpacked/core/pre-install"
        : "/core/pre-install"
    );
    return readdirSync(basePluginPath)
      .filter((file) => extname(file) === ".tgz")
      .map((file) => join(basePluginPath, file));
  });

  ipcMain.handle("pluginPath", async (_event) => {
    return join(app.getPath("userData"), "plugins");
  });
  ipcMain.handle("appVersion", async (_event) => {
    return app.getVersion();
  });
  ipcMain.handle("openExternalUrl", async (_event, url) => {
    shell.openExternal(url);
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
      .on("progress", function (state: any) {
        mainWindow?.webContents.send("FILE_DOWNLOAD_UPDATE", {
          ...state,
          fileName,
        });
      })
      .on("error", function (err: Error) {
        mainWindow?.webContents.send("FILE_DOWNLOAD_ERROR", {
          fileName,
          err,
        });
      })
      .on("end", function () {
        mainWindow?.webContents.send("FILE_DOWNLOAD_COMPLETE", {
          fileName,
        });
      })
      .pipe(createWriteStream(destination));
  });
}

function migratePlugins() {
  return new Promise((resolve) => {
    const store = new Store();
    if (store.get("migrated_version") !== app.getVersion()) {
      console.log("start migration:", store.get("migrated_version"));
      const userDataPath = app.getPath("userData");
      const fullPath = join(userDataPath, "plugins");

      rmdir(fullPath, { recursive: true }, function (err) {
        if (err) console.log(err);
        store.set("migrated_version", app.getVersion());
        console.log("migrate plugins done");
        resolve(undefined);
      });
    } else {
      resolve(undefined);
    }
  });
}

function setupPlugins() {
  init({
    // Function to check from the main process that user wants to install a plugin
    confirmInstall: async (_plugins: string[]) => {
      return true;
    },
    // Path to install plugin to
    pluginsPath: join(app.getPath("userData"), "plugins"),
  });
}
