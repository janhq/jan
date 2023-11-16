/**
 * @deprecated This object is deprecated and should not be used.
 * Use individual functions instead.
 */
export { core, deleteFile, invokePluginFunc } from "./core";

/**
 * Core module exports.
 * @module
 */
export { downloadFile, executeOnMain, appDataPath } from "./core";

/**
 * Events module exports.
 * @module
 */
export { events } from "./events";

/**
 * Events types exports.
 * @module
 */
export * from "./events";

export * from "./types/index";

/**
 * Filesystem module exports.
 * @module
 */
export { fs } from "./fs";

/**
 * Plugin base module export.
 * @module
 */
export { JanPlugin, PluginType } from "./plugin";
