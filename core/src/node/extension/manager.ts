import { join, resolve } from "path";

import { existsSync, mkdirSync, writeFileSync } from "fs";
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
