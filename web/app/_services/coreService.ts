import { store } from "./storeService";
export const setupCoreServices = () => {
  if (!window.corePlugin) {
    window.corePlugin = {
      store,
    };
  }
};
