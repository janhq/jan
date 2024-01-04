import { join, resolve } from "path";

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { init } from "./index";
import { homedir } from "os"
/**
 * Manages extension installation and migration.
 */

export const userSpacePath = join(homedir(), "jan");

export class ExtensionManager {
  public static instance: ExtensionManager = new ExtensionManager();

  extensionsPath: string | undefined = join(userSpacePath, "extensions");

  constructor() {
    if (ExtensionManager.instance) {
      return ExtensionManager.instance;
    }
  }

  /**
   * Sets up the extensions by initializing the `extensions` module with the `confirmInstall` and `extensionsPath` options.
   * The `confirmInstall` function always returns `true` to allow extension installation.
   * The `extensionsPath` option specifies the path to install extensions to.
   */
  setupExtensions() {
    init({
      // Function to check from the main process that user wants to install a extension
      confirmInstall: async (_extensions: string[]) => {
        return true;
      },
      // Path to install extension to
      extensionsPath: join(userSpacePath, "extensions"),
    });
  }

  setExtensionsPath(extPath: string) {
    // Create folder if it does not exist
    let extDir;
    try {
      extDir = resolve(extPath);
      if (extDir.length < 2) throw new Error();

      if (!existsSync(extDir)) mkdirSync(extDir);

      const extensionsJson = join(extDir, "extensions.json");
      if (!existsSync(extensionsJson))
        writeFileSync(extensionsJson, "{}");

      this.extensionsPath = extDir;
    } catch (error) {
      throw new Error("Invalid path provided to the extensions folder");
    }
  }

  getExtensionsFile() {
    return join(this.extensionsPath ?? "", "extensions.json");
  }
}
