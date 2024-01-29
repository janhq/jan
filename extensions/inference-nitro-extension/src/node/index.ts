import path from "node:path";
import { getJanDataFolderPath, log, normalizeFilePath } from "@janhq/core/node";
import {
  setLogger,
  setBinPath as nitroSetBinPath,
  runModel as nitroRunModel,
  updateNvidiaInfo as nitroUpdateNvidiaInfo,
  NitroModelInitOptions,
} from "@janhq/nitro-node";

import { getCurrentNitroProcessInfo } from "@janhq/nitro-node";
import { debugInspector, debugInspectorSync } from "./debugInspector";

/**
 * Update nvidia driver info
 */
const updateNvidiaInfo = async (): Promise<any> =>
  await sanitizePromise(nitroUpdateNvidiaInfo());

/**
 * Resolve file url path from string
 */
const _resolvePath = (fileURL: string) => {
  const absPath = path.join(getJanDataFolderPath(), normalizeFilePath(fileURL));
  return absPath;
};
/**
 * Resolve file url path from string
 * Also with possibility to show debug information
 */
const resolvePath = (fileURL: string) =>
  process.env.DEBUG
    ? debugInspectorSync(_resolvePath)(fileURL)
    : _resolvePath(fileURL);

/**
 * Strip any non-serializable properties from an object or array
 */
const safeSerialization = (obj: any): any => JSON.parse(JSON.stringify(obj));
/**
 * Sanitize any Promise to a serializable version
 */
const sanitizePromise = <T>(p: Promise<T>): Promise<any> =>
  p.then(safeSerialization).catch(safeSerialization);

/**
 * Set binary path for nitro binaries
 */
const setBinPath = async (urlBinPath: string): Promise<any> =>
  await sanitizePromise(nitroSetBinPath(resolvePath(urlBinPath)));

/**
 * Start nitro and run the model
 */
const runModel = async (
  modelInitOptions: NitroModelInitOptions,
): Promise<any> =>
  await sanitizePromise(
    nitroRunModel({
      modelFullPath: resolvePath(modelInitOptions.modelFullPath),
      promptTemplate: modelInitOptions.promptTemplate,
    }),
  );

// Set nitro logger upon module loaded
setLogger(log);

// Conditional export with param logging if running in debug mode
export default {
  getCurrentNitroProcessInfo,
  updateNvidiaInfo,
  setBinPath: process.env.DEBUG ? debugInspector(setBinPath) : setBinPath,
  runModel: process.env.DEBUG ? debugInspector(runModel) : runModel,
};
