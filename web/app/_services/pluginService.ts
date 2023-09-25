"use client";
import {
  extensionPoints,
  plugins,
} from "../../../electron/core/plugin-manager/execution/index";
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
  if (
    typeof window === "undefined" ||
    typeof window.electronAPI === "undefined"
  ) {
    return;
  }
  const userDataPath = await window.electronAPI.userData();
  const basePlugin = userDataPath + "/core/pre-install/base-plugin.tgz";
  const dataPlugin = userDataPath + "/core/pre-install/data-plugin.tgz";
  const modelManagementPlugin =
    userDataPath + "/core/pre-install/model-management-plugin.tgz";
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
    return Promise.resolve(undefined);
  }
  return extensionPoints.executeSerial(name, args);
};
