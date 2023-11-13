import { app, dialog } from "electron";
import { WindowManager } from "../managers/window";
import { autoUpdater } from "electron-updater";

export function handleAppUpdates() {
  /* Should not check for update during development */
  if (!app.isPackaged) {
    return;
  }
  /* New Update Available */
  autoUpdater.on("update-available", async (_info: any) => {
    const action = await dialog.showMessageBox({
      message: `Update available. Do you want to download the latest update?`,
      buttons: ["Download", "Later"],
    });
    if (action.response === 0) await autoUpdater.downloadUpdate();
  });

  /* App Update Completion Message */
  autoUpdater.on("update-downloaded", async (_info: any) => {
    WindowManager.instance.currentWindow?.webContents.send(
      "APP_UPDATE_COMPLETE",
      {}
    );
    const action = await dialog.showMessageBox({
      message: `Update downloaded. Please restart the application to apply the updates.`,
      buttons: ["Restart", "Later"],
    });
    if (action.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  /* App Update Error */
  autoUpdater.on("error", (info: any) => {
    dialog.showMessageBox({ message: info.message });
    WindowManager.instance.currentWindow?.webContents.send(
      "APP_UPDATE_ERROR",
      {}
    );
  });

  /* App Update Progress */
  autoUpdater.on("download-progress", (progress: any) => {
    console.debug("app update progress: ", progress.percent);
    WindowManager.instance.currentWindow?.webContents.send(
      "APP_UPDATE_PROGRESS",
      {
        percent: progress.percent,
      }
    );
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.CI !== "e2e") {
    autoUpdater.checkForUpdates();
  }
}
