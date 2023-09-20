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

let modelSession = undefined;

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

  let modelName = "llama-2-7b-chat.gguf.q4_0.bin";

  import("../node_modules/node-llama-cpp/dist/index.js").then(
    ({ LlamaContext, LlamaChatSession, LlamaModel }) => {
      const modelPath = path.join(app.getPath("userData"), modelName);
      const model = new LlamaModel({
        modelPath: modelPath,
      });
      const context = new LlamaContext({ model });
      modelSession = new LlamaChatSession({ context });
    }
  );

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
          return plugin[method](args);
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
