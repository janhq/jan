import { AppConfiguration } from "../../types";
import { join } from "path";
import fs from "fs";
import os from "os";

// TODO: move this to core
const configurationFileName = "settings.json";

// TODO: do no specify app name in framework module
const defaultJanDataFolder = join(os.homedir(), "jan");
const defaultAppConfig: AppConfiguration = {
  data_folder: defaultJanDataFolder,
};

/**
 * Getting App Configurations.
 *
 * @returns {AppConfiguration} The app configurations.
 */
export const getAppConfigurations = (): AppConfiguration => {
  // Retrieve Application Support folder path
  // Fallback to user home directory if not found
  const configurationFile = getConfigurationFilePath();

  if (!fs.existsSync(configurationFile)) {
    // create default app config if we don't have one
    console.debug(`App config not found, creating default config at ${configurationFile}`);
    fs.writeFileSync(configurationFile, JSON.stringify(defaultAppConfig));
    return defaultAppConfig;
  }

  try {
    const appConfigurations: AppConfiguration = JSON.parse(
      fs.readFileSync(configurationFile, "utf-8"),
    );
    return appConfigurations;
  } catch (err) {
    console.error(`Failed to read app config, return default config instead! Err: ${err}`);
    return defaultAppConfig;
  }
};

const getConfigurationFilePath = () =>
  join(
    global.core?.appPath() || process.env[process.platform == "win32" ? "USERPROFILE" : "HOME"],
    configurationFileName,
  );

export const updateAppConfiguration = (configuration: AppConfiguration): Promise<void> => {
  const configurationFile = getConfigurationFilePath();
  console.debug("updateAppConfiguration, configurationFile: ", configurationFile);

  fs.writeFileSync(configurationFile, JSON.stringify(configuration));
  return Promise.resolve();
};

/**
 * Utility function to get server log path
 *
 * @returns {string} The log path.
 */
export const getServerLogPath = (): string => {
  const appConfigurations = getAppConfigurations();
  const logFolderPath = join(appConfigurations.data_folder, "logs");
  if (!fs.existsSync(logFolderPath)) {
    fs.mkdirSync(logFolderPath, { recursive: true });
  }
  return join(logFolderPath, "server.log");
};

/**
 * Utility function to get app log path
 *
 * @returns {string} The log path.
 */
export const getAppLogPath = (): string => {
  const appConfigurations = getAppConfigurations();
  const logFolderPath = join(appConfigurations.data_folder, "logs");
  if (!fs.existsSync(logFolderPath)) {
    fs.mkdirSync(logFolderPath, { recursive: true });
  }
  return join(logFolderPath, "app.log");
};

/**
 * Utility function to get data folder path
 *
 * @returns {string} The data folder path.
 */
export const getJanDataFolderPath = (): string => {
  const appConfigurations = getAppConfigurations();
  return appConfigurations.data_folder;
};

/**
 * Utility function to get extension path
 *
 * @returns {string} The extensions path.
 */
export const getJanExtensionsPath = (): string => {
  const appConfigurations = getAppConfigurations();
  return join(appConfigurations.data_folder, "extensions");
};
