import { extensionPoints } from "../../node_modules/pluggable-electron/dist/execution.es";

export const invoke = async (name: string, args?: any) => {
  const data = await extensionPoints.executeSerial(name, args);
  return data;
};
