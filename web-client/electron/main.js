const {
  app,
  BrowserWindow,
  screen: electronScreen,
  dialog,
} = require("electron");
const isDev = require("electron-is-dev");
const path = require("path");
const pe = require("pluggable-electron/main");

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
  const startURL = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../out/index.html")}`;

  mainWindow.loadURL(startURL);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createMainWindow();

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
      console.log("Main:", answer);
      return answer.response == 0;
    },
    // Path to install plugin to
    pluginsPath: path.join(app.getPath("userData"), "plugins"),
  });
  console.log(path.join(app.getPath("userData"), "plugins"));
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
