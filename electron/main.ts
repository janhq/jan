import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
} from "electron";
import { readdirSync, writeFileSync } from "fs";
import { resolve, join, extname } from "path";
import { rmdir, unlink, createWriteStream } from "fs";
import { init } from "./core/plugin/index";
import { setupMenu } from "./utils/menu";
import { dispose } from "./utils/disposable";

const pacote = require("pacote");
const request = require("request");
const progress = require("request-progress");
const { autoUpdater } = require("electron-updater");
const Store = require("electron-store");

let requiredModules: Record<string, any> = {};
const networkRequests: Record<string, any> = {};
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
  clearImportedModules();
  app.quit();
});

app.on("quit", () => {
  clearImportedModules();
  app.quit();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    trafficLightPosition: {
      x: 16,
      y: 10,
    },
    titleBarStyle: "hidden",
    vibrancy: "sidebar",
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
  if (process.env.CI !== "e2e") {
    autoUpdater.checkForUpdates();
  }
}

/**
 * Handles various IPC messages from the renderer process.
 */
function handleIPCs() {
  /**
   * Handles the "setNativeThemeLight" IPC message by setting the native theme source to "light".
   * This will change the appearance of the app to the light theme.
   */
  ipcMain.handle("setNativeThemeLight", () => {
    nativeTheme.themeSource = "light";
  });

  /**
   * Handles the "setNativeThemeDark" IPC message by setting the native theme source to "dark".
   * This will change the appearance of the app to the dark theme.
   */
  ipcMain.handle("setNativeThemeDark", () => {
    nativeTheme.themeSource = "dark";
  });

  /**
   * Handles the "setNativeThemeSystem" IPC message by setting the native theme source to "system".
   * This will change the appearance of the app to match the system's current theme.
   */
  ipcMain.handle("setNativeThemeSystem", () => {
    nativeTheme.themeSource = "system";
  });

  /**
   * Invokes a function from a plugin module in main node process.
   * @param _event - The IPC event object.
   * @param modulePath - The path to the plugin module.
   * @param method - The name of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns The result of the invoked function.
   */
  ipcMain.handle(
    "invokePluginFunc",
    async (_event, modulePath, method, ...args) => {
      const module = require(
        /* webpackIgnore: true */ join(
          app.getPath("userData"),
          "plugins",
          modulePath
        )
      );
      requiredModules[modulePath] = module;

      if (typeof module[method] === "function") {
        return module[method](...args);
      } else {
        console.log(module[method]);
        console.error(`Function "${method}" does not exist in the module.`);
      }
    }
  );

  /**
   * Returns the paths of the base plugins.
   * @param _event - The IPC event object.
   * @returns An array of paths to the base plugins.
   */
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

  /**
   * Returns the path to the user's plugin directory.
   * @param _event - The IPC event object.
   * @returns The path to the user's plugin directory.
   */
  ipcMain.handle("pluginPath", async (_event) => {
    return join(app.getPath("userData"), "plugins");
  });

  /**
   * Retrieves the path to the app data directory using the `coreAPI` object.
   * If the `coreAPI` object is not available, the function returns `undefined`.
   * @returns A Promise that resolves with the path to the app data directory, or `undefined` if the `coreAPI` object is not available.
   */
  ipcMain.handle("appDataPath", async (_event) => {
    return app.getPath("userData");
  });

  /**
   * Returns the version of the app.
   * @param _event - The IPC event object.
   * @returns The version of the app.
   */
  ipcMain.handle("appVersion", async (_event) => {
    return app.getVersion();
  });

  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle("openAppDirectory", async (_event) => {
    shell.openPath(app.getPath("userData"));
  });

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle("openExternalUrl", async (_event, url) => {
    shell.openExternal(url);
  });

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle("relaunch", async (_event, url) => {
    clearImportedModules();

    if (app.isPackaged) {
      app.relaunch();
      app.exit();
    } else {
      for (const modulePath in requiredModules) {
        delete require.cache[
          require.resolve(join(app.getPath("userData"), "plugins", modulePath))
        ];
      }
      setupPlugins();
      mainWindow?.reload();
    }
  });

  /**
   * Deletes the `plugins` directory in the user data path and disposes of required modules.
   * If the app is packaged, the function relaunches the app and exits.
   * Otherwise, the function deletes the cached modules and sets up the plugins and reloads the main window.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle("reloadPlugins", async (_event, url) => {
    const userDataPath = app.getPath("userData");
    const fullPath = join(userDataPath, "plugins");

    rmdir(fullPath, { recursive: true }, function (err) {
      if (err) console.log(err);
      clearImportedModules();

      // just relaunch if packaged, should launch manually in development mode
      if (app.isPackaged) {
        app.relaunch();
        app.exit();
      } else {
        for (const modulePath in requiredModules) {
          delete require.cache[
            require.resolve(
              join(app.getPath("userData"), "plugins", modulePath)
            )
          ];
        }
        setupPlugins();
        mainWindow?.reload();
      }
    });
  });

  /**
   * Deletes a file from the user data folder.
   * @param _event - The IPC event object.
   * @param filePath - The path to the file to delete.
   * @returns A string indicating the result of the operation.
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
   * Downloads a file from a given URL.
   * @param _event - The IPC event object.
   * @param url - The URL to download the file from.
   * @param fileName - The name to give the downloaded file.
   */
  ipcMain.handle("downloadFile", async (_event, url, fileName) => {
    const userDataPath = app.getPath("userData");
    const destination = resolve(userDataPath, fileName);
    const rq = request(url);

    progress(rq, {})
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
        networkRequests[fileName] = undefined;
      })
      .on("end", function () {
        if (networkRequests[fileName]) {
          mainWindow?.webContents.send("FILE_DOWNLOAD_COMPLETE", {
            fileName,
          });
          networkRequests[fileName] = undefined;
        } else {
          mainWindow?.webContents.send("FILE_DOWNLOAD_ERROR", {
            fileName,
            err: "Download cancelled",
          });
        }
      })
      .pipe(createWriteStream(destination));

    networkRequests[fileName] = rq;
  });

  /**
   * Handles the "pauseDownload" IPC message by pausing the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle("pauseDownload", async (_event, fileName) => {
    networkRequests[fileName]?.pause();
  });

  /**
   * Handles the "resumeDownload" IPC message by resuming the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle("resumeDownload", async (_event, fileName) => {
    networkRequests[fileName]?.resume();
  });

  /**
   * Handles the "abortDownload" IPC message by aborting the download associated with the provided fileName.
   * The network request associated with the fileName is then removed from the networkRequests object.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle("abortDownload", async (_event, fileName) => {
    const rq = networkRequests[fileName];
    networkRequests[fileName] = undefined;
    rq?.abort();
  });

  /**
   * Installs a remote plugin by downloading its tarball and writing it to a tgz file.
   * @param _event - The IPC event object.
   * @param pluginName - The name of the remote plugin to install.
   * @returns A Promise that resolves to the path of the installed plugin file.
   */
  ipcMain.handle("installRemotePlugin", async (_event, pluginName) => {
    const destination = join(
      app.getPath("userData"),
      pluginName.replace(/^@.*\//, "") + ".tgz"
    );
    return pacote
      .manifest(pluginName)
      .then(async (manifest: any) => {
        await pacote.tarball(manifest._resolved).then((data: Buffer) => {
          writeFileSync(destination, data);
        });
      })
      .then(() => destination);
  });
}

/**
 * Migrates the plugins by deleting the `plugins` directory in the user data path.
 * If the `migrated_version` key in the `Store` object does not match the current app version,
 * the function deletes the `plugins` directory and sets the `migrated_version` key to the current app version.
 * @returns A Promise that resolves when the migration is complete.
 */
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

/**
 * Sets up the plugins by initializing the `plugins` module with the `confirmInstall` and `pluginsPath` options.
 * The `confirmInstall` function always returns `true` to allow plugin installation.
 * The `pluginsPath` option specifies the path to install plugins to.
 */
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

function clearImportedModules() {
  dispose(requiredModules);
  requiredModules = {};
}

ipcMain.handle("openWindow", async (_event, url) => {
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    trafficLightPosition: {
      x: 16,
      y: 10,
    },
    titleBarStyle: "hidden",
    vibrancy: "sidebar",
    webPreferences: {
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  newWindow.loadURL(url);
});