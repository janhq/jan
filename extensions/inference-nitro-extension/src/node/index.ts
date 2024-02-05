import path from "node:path";
import fs from "node:fs";
import { getJanDataFolderPath, log, normalizeFilePath } from "@janhq/core/node";
import {
  initialize as nitroInitialize,
  setLogger as nitroSetLogger,
  setBinPath as nitroSetBinPath,
  runModel as nitroRunModel,
  NitroModelInitOptions,
  getCurrentNitroProcessInfo,
  getNvidiaConfig as nitroGetNvidiaConfig,
  setNvidiaConfig as nitroSetNvidiaConfig,
  NitroNvidiaConfig,
} from "@janhq/nitro-node";

/**
 * Strip any non-serializable properties from an object or array
 */
const safeSerialization = <T>(obj: T): Partial<T> =>
  JSON.parse(JSON.stringify(obj));
/**
 * Sanitize any Promise to a serializable version
 */
const sanitizePromise = <T>(p: Promise<T>): Promise<Partial<T>> =>
  p.then(safeSerialization).catch(safeSerialization);

/**
 * Resolve file url path from string
 */
const resolvePath = (fileURL: string): string => {
  const absPath = path.join(getJanDataFolderPath(), normalizeFilePath(fileURL));
  return absPath;
};

/**
 * Path to the settings file
 **/
export const NVIDIA_INFO_FILE = path.join(
  getJanDataFolderPath(),
  "settings",
  "settings.json",
);

/**
 * Read settings.json and call setNvidiaConfig
 */
const setNvidiaConfigFromFile = async (): Promise<void> => {
  try {
    const data = JSON.parse(fs.readFileSync(NVIDIA_INFO_FILE, "utf-8"));
    return await nitroSetNvidiaConfig(data);
  } catch (error) {
    return;
  }
};
/**
 * Save updated Nvidia config into file
 */
const saveNvidiaConfigToFile = async (): Promise<void> => {
  const nvidiaConfig = nitroGetNvidiaConfig();
  fs.writeFileSync(NVIDIA_INFO_FILE, JSON.stringify(nvidiaConfig, null, 2));
};

/**
 * Initialize nitro
 */
const _initialize = async (): Promise<void> => {
  await setNvidiaConfigFromFile();
  await sanitizePromise(nitroInitialize());
  await saveNvidiaConfigToFile();
};

/**
 * Wrapper to allow safe call from IPC
 */
const initialize = async (): Promise<void> =>
  await sanitizePromise(_initialize());

/**
 * Set logger for nitro
 */
const setLogger = async (log: any): Promise<void> =>
  await sanitizePromise(nitroSetLogger(log));

/**
 * Set binary path for nitro binaries
 */
const setBinPath = async (urlBinPath: string): Promise<void> =>
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
