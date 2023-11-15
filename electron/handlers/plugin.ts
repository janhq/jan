import { app, ipcMain } from "electron";
import { readdirSync, rmdir, writeFileSync } from "fs";
import { ModuleManager } from "../managers/module";
import { join, extname } from "path";
import { PluginManager } from "../managers/plugin";
import { WindowManager } from "../managers/window";
import { manifest, tarball } from "pacote";

export function handlePluginIPCs() {
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
      ModuleManager.instance.setModule(modulePath, module);

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
        ? "../../app.asar.unpacked/core/pre-install"
        : "../core/pre-install"
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
      ModuleManager.instance.clearImportedModules();

      // just relaunch if packaged, should launch manually in development mode
      if (app.isPackaged) {
        app.relaunch();
        app.exit();
      } else {
        for (const modulePath in ModuleManager.instance.requiredModules) {
          delete require.cache[
            require.resolve(
              join(app.getPath("userData"), "plugins", modulePath)
            )
          ];
        }
        PluginManager.instance.setupPlugins();
        WindowManager.instance.currentWindow?.reload();
      }
    });
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
    return manifest(pluginName)
      .then(async (manifest: any) => {
        await tarball(manifest._resolved).then((data: Buffer) => {
          writeFileSync(destination, data);
        });
      })
      .then(() => destination);
  });
}
