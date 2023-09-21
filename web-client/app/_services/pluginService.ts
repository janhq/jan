import { extensionPoints } from "../../node_modules/pluggable-electron/dist/execution.es";
import {
  CoreService,
} from "../../shared/coreService";

export const execute = (name: CoreService, args?: any) => {
  return extensionPoints.execute(name, args);
};

export const executeSerial = (name: CoreService, args?: any) => {
  return extensionPoints.executeSerial(name, args);
};
