"use client";
import {
  extensionPoints,
  plugins,
} from "../../../electron/core/plugin-manager/execution/index";
import {
  CoreService,
  DataService,
  InferenceService,
  ModelManagementService,
} from "../../shared/coreService";

export const isCorePluginInstalled = () => {
  if (!extensionPoints.get(DataService.GET_CONVERSATIONS)) {
    return false;
  }
  if (!extensionPoints.get(InferenceService.INIT_MODEL)) {
    return false;
  }
  if (!extensionPoints.get(ModelManagementService.DOWNLOAD_MODEL)) {
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
  const basePlugins = await window.electronAPI.basePlugins();

  if (
    !extensionPoints.get(DataService.GET_CONVERSATIONS) ||
    !extensionPoints.get(InferenceService.INIT_MODEL) ||
    !extensionPoints.get(ModelManagementService.DOWNLOAD_MODEL)
  ) {
    const installed = await plugins.install(basePlugins);
    if (installed) {
      window.location.reload();
    }
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
