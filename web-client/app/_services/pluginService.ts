import {
  extensionPoints,
  plugins,
} from "../../node_modules/pluggable-electron/dist/execution.es";
import {
  CoreService,
  DataService,
  InfereceService,
  ModelManagementService,
} from "../../shared/coreService";

export const isCorePluginInstalled = () => {
  if (!extensionPoints.get(DataService.GET_CONVERSATIONS)) {
    return false;
  }
  if (!extensionPoints.get(InfereceService.INFERENCE)) {
    return false;
  }
  if (!extensionPoints.get(ModelManagementService.GET_DOWNLOADED_MODELS)) {
    return false;
  }
  return true;
};
export const setupBasePlugins = async () => {
  const basePlugin = "electron/core/pre-install/base-plugin.tgz";
  const dataPlugin = "electron/core/pre-install/data-plugin.tgz";
  const modelManagementPlugin =
    "electron/core/pre-install/model-management-plugin.tgz";
  const toInstall = [];
  if (!extensionPoints.get(DataService.GET_CONVERSATIONS)) {
    toInstall.push(dataPlugin);
  }
  if (!extensionPoints.get(InfereceService.INFERENCE)) {
    toInstall.push(basePlugin);
  }
  if (!extensionPoints.get(ModelManagementService.GET_DOWNLOADED_MODELS)) {
    toInstall.push(modelManagementPlugin);
  }
  const installed = await plugins.install(toInstall);
  if (installed) {
    window.location.reload();
  }
};

export const execute = (name: CoreService, args?: any) => {
  if (!extensionPoints.get(name)) {
    alert("Missing extension for function: " + name);
    return undefined;
  }
  return extensionPoints.execute(name, args);
};

export const executeSerial = (name: CoreService, args?: any) => {
  if (!extensionPoints.get(name)) {
    alert("Missing extension for function: " + name);
    return undefined;
  }
  return extensionPoints.executeSerial(name, args);
};
