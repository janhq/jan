import { fileURLToPath } from "node:url";
import { log } from "@janhq/core/node";
import {
  setLogger,
  setBinPath as nitroSetBinPath,
  runModel as nitroRunModel,
  updateNvidiaInfo as nitroUpdateNvidiaInfo,
  NitroModelInitOptions,
} from "@janhq/nitro-node";

import { getCurrentNitroProcessInfo } from "@janhq/nitro-node";
import { debugInspector } from "./debugInspector";

/**
 * Update nvidia driver info
 */
const updateNvidiaInfo = async (): Promise<any> =>
  await sanitizePromise(nitroUpdateNvidiaInfo());

// FIXME: currently using current directory of the process as base path
let basePath = process.cwd();

/**
 * Set absolute system path for working directory
 */
const setBasePath = (absPath: string) => (basePath = absPath);

/**
 * Resolve file url path from string
 */
const resolvePath = (fileURL: string) => {
  if (process.env.DEBUG) {
    log(`Resolving path ${fileURL}`);
  }
  const absPath = fileURLToPath(
    fileURL.replace(/^file:\/\//, `file://${basePath}/`),
  );
  if (process.env.DEBUG) {
    log(`Resolved path ${fileURL} to ${absPath}`);
  }
  return absPath;
};

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
  setBasePath: process.env.DEBUG ? debugInspector(setBasePath) : setBasePath,
  setBinPath: process.env.DEBUG ? debugInspector(setBinPath) : setBinPath,
  runModel: process.env.DEBUG ? debugInspector(runModel) : runModel,
};
