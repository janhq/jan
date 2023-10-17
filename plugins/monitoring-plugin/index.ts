import { core, SystemMonitoringService } from "@janhq/core";

// Provide an async method to manipulate the price provided by the extension point
const getResourcesInfo = () => core.invokePluginFunc(MODULE_PATH, "getResourcesInfo");

const getCurrentLoad = () => core.invokePluginFunc(MODULE_PATH, "getCurrentLoad");

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register(SystemMonitoringService.GetResourcesInfo, getResourcesInfo.name, getResourcesInfo);
  register(SystemMonitoringService.GetCurrentLoad, getCurrentLoad.name, getCurrentLoad);
}
