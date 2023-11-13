import { app } from "electron";
import { init } from "../core/plugin/index";
import { join } from "path";
import { rmdir } from "fs";
import Store from "electron-store";

/**
 * Manages plugin installation and migration.
 */
export class PluginManager {
  public static instance: PluginManager = new PluginManager();

  constructor() {
    if (PluginManager.instance) {
      return PluginManager.instance;
    }
  }

  /**
   * Sets up the plugins by initializing the `plugins` module with the `confirmInstall` and `pluginsPath` options.
   * The `confirmInstall` function always returns `true` to allow plugin installation.
   * The `pluginsPath` option specifies the path to install plugins to.
   */
  setupPlugins() {
    init({
      // Function to check from the main process that user wants to install a plugin
      confirmInstall: async (_plugins: string[]) => {
        return true;
      },
      // Path to install plugin to
      pluginsPath: join(app.getPath("userData"), "plugins"),
    });
  }

  /**
   * Migrates the plugins by deleting the `plugins` directory in the user data path.
   * If the `migrated_version` key in the `Store` object does not match the current app version,
   * the function deletes the `plugins` directory and sets the `migrated_version` key to the current app version.
   * @returns A Promise that resolves when the migration is complete.
   */
  migratePlugins() {
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
}
