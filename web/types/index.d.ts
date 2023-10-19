export {};

declare const PLUGIN_CATALOGS: string[];
declare global {
  interface Window {
    electronAPI?: any | undefined;
    corePlugin?: any | undefined;
    coreAPI?: any | undefined;
  }
}
