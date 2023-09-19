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
// const expr = require("./app-express");

const createMainWindow = () => {
  let mainWindow = new BrowserWindow({
    width: electronScreen.getPrimaryDisplay().workArea.width,
    height: electronScreen.getPrimaryDisplay().workArea.height,
    show: false,
    backgroundColor: "white",
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  ipcMain.on("invokePluginSep", async (event, plugin, method) => {
    const plg = pe
      .getStore()
      .getActivePlugins()
      // @ts-ignore
      .filter((p) => p.name === plugin)[0];
    const pluginPath = path.join(
      app.getPath("userData"),
      "plugins",
      plg.name,
      "dist/module.js"
    );
    await import(
      /* webpackIgnore: true */
      pluginPath
    )
      .then((plugin) => {
        if (typeof plugin[method] === "function") {
          plugin[method](); // Call the function dynamically
        } else {
          console.error(`Function "${method}" does not exist in the module.`);
        }
      })
      .catch((err) => console.log(err));
  });

  const startURL = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../out/index.html")}`;

  mainWindow.loadURL(startURL);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createMainWindow();

  pe.init({
    // Function to check from the main process that user wants to install a plugin
    //@ts-ignore
    confirmInstall: async (plugins) => {
      const answer = await dialog.showMessageBox({
        message: `Are you sure you want to install the plugin ${plugins.join(
          ", "
        )}`,
        buttons: ["Ok", "Cancel"],
        cancelId: 1,
      });
      console.log("Main:", answer);
      return answer.response == 0;
    },
    // Path to install plugin to
    pluginsPath: path.join(app.getPath("userData"), "plugins"),
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


// Spawn the Express server as a separate process
const { spawn } = require('child_process');
const expressServer = spawn('node', ['electron/app-express.js']);
expressServer.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});
expressServer.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});
expressServer.on('close', (code) => {
  console.log(`Express server process exited with code ${code}`);
});
