/**
 * @deprecated This object is deprecated and should not be used.
 * Use individual functions instead.
 */
export { core, deleteFile, invokePluginFunc } from "./core";

/**
 * Core module exports.
 * @module
 */
export { downloadFile, executeOnMain } from "./core";

/**
 * Events module exports.
 * @module
 */
export { events } from "./events";

/**
 * Events types exports.
 * @module
 */
export {
  EventName,
  NewMessageRequest,
  NewMessageResponse,
  MessageHistory,
} from "./events";

/**
 * Filesystem module exports.
 * @module
 */
export { fs } from "./fs";

export { JanPlugin, PluginType } from "./plugin";
