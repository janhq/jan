import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export let pluginsPath: string | undefined = undefined;

/**
 * @private
 * Set path to plugins directory and create the directory if it does not exist.
 * @param {string} plgPath path to plugins directory
 */
export function setPluginsPath(plgPath: string) {
  // Create folder if it does not exist
  let plgDir;
  try {
    plgDir = resolve(plgPath);
    if (plgDir.length < 2) throw new Error();

    if (!existsSync(plgDir)) mkdirSync(plgDir);

    const pluginsJson = join(plgDir, "plugins.json");
    if (!existsSync(pluginsJson)) writeFileSync(pluginsJson, "{}", "utf8");

    pluginsPath = plgDir;
  } catch (error) {
    throw new Error("Invalid path provided to the plugins folder");
  }
}

/**
 * @private
 * Get the path to the plugins.json file.
 * @returns location of plugins.json
 */
export function getPluginsFile() {
  return join(pluginsPath ?? "", "plugins.json");
}