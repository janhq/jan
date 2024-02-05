import path from "node:path";
import { getJanDataFolderPath, log, normalizeFilePath } from "@janhq/core/node";
import {
  initialize as nitroInitialize,
  setLogger,
  setBinPath as nitroSetBinPath,
  runModel as nitroRunModel,
  NitroModelInitOptions,
} from "@janhq/nitro-node";

import { getCurrentNitroProcessInfo } from "@janhq/nitro-node";

/**
 * Initialize nitro
 */
const initialize = async (): Promise<any> =>
  await sanitizePromise(nitroInitialize());

/**
 * Resolve file url path from string
 */
const resolvePath = (fileURL: string) => {
  const absPath = path.join(getJanDataFolderPath(), normalizeFilePath(fileURL));
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
      modelPath: resolvePath(modelInitOptions.modelPath),
      promptTemplate: modelInitOptions.promptTemplate,
    }),
  );

// Set nitro logger upon module loaded
setLogger(log);
// Set default bin path to within the extension's root
// In build phase, the binaries will be downloaded and packed in advance
setBinPath(path.join(__dirname, "..", "..", "bin"));

export default {
  initialize,
  getCurrentNitroProcessInfo,
  runModel,
};
