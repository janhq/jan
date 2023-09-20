import { extensionPoints } from "../../node_modules/pluggable-electron/dist/execution.es";
import { DataService } from "../../shared/coreService";

export const invokeDataService = async (name: DataService, args?: any) => {
  const data = await extensionPoints.executeSerial(name, args);
  return data;
};
