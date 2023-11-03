import { ipcMain, webContents } from "electron";

import {
  getPlugin,
  getActivePlugins,
  installPlugins,
  removePlugin,
  getAllPlugins,
} from "./store";
import { pluginsPath } from "./globals";
import Plugin from "./plugin";

// Throw an error if pluginsPath has not yet been provided by usePlugins.
const checkPluginsPath = () => {
  if (!pluginsPath)
    throw Error("Path to plugins folder has not yet been set up.");
};
let active = false;
/**
 * Provide the renderer process access to the plugins.
 **/
export default function () {
  if (active) return;
  // Register IPC route to install a plugin
  ipcMain.handle("pluggable:install", async (e, plugins) => {
    checkPluginsPath();

    // Install and activate all provided plugins
    const installed = await installPlugins(plugins);
    return JSON.parse(JSON.stringify(installed));
  });

  // Register IPC route to uninstall a plugin
  ipcMain.handle("pluggable:uninstall", async (e, plugins, reload) => {
    checkPluginsPath();

    // Uninstall all provided plugins
    for (const plg of plugins) {
      const plugin = getPlugin(plg);
      await plugin.uninstall();
      if (plugin.name) removePlugin(plugin.name);
    }

    // Reload all renderer pages if needed
    reload && webContents.getAllWebContents().forEach((wc) => wc.reload());
    return true;
  });

  // Register IPC route to update a plugin
  ipcMain.handle("pluggable:update", async (e, plugins, reload) => {
    checkPluginsPath();

    // Update all provided plugins
    const updated: Plugin[] = [];
    for (const plg of plugins) {
      const plugin = getPlugin(plg);
      const res = await plugin.update();
      if (res) updated.push(plugin);
    }

    // Reload all renderer pages if needed
    if (updated.length && reload)
      webContents.getAllWebContents().forEach((wc) => wc.reload());

    return JSON.parse(JSON.stringify(updated));
  });

  // Register IPC route to check if updates are available for a plugin
  ipcMain.handle("pluggable:updatesAvailable", (e, names) => {
    checkPluginsPath();

    const plugins = names
      ? names.map((name: string) => getPlugin(name))
      : getAllPlugins();

    const updates: Record<string, Plugin> = {};
    for (const plugin of plugins) {
      updates[plugin.name] = plugin.isUpdateAvailable();
    }
    return updates;
  });

  // Register IPC route to get the list of active plugins
  ipcMain.handle("pluggable:getActivePlugins", () => {
    checkPluginsPath();
    return JSON.parse(JSON.stringify(getActivePlugins()));
  });

  // Register IPC route to toggle the active state of a plugin
  ipcMain.handle("pluggable:togglePluginActive", (e, plg, active) => {
    checkPluginsPath();
    const plugin = getPlugin(plg);
    return JSON.parse(JSON.stringify(plugin.setActive(active)));
  });

  active = true;
}
