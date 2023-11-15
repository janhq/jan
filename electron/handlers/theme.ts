import { ipcMain, nativeTheme } from "electron";

export function handleThemesIPCs() {
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
}
