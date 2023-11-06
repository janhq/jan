export {};

declare global {
  interface CorePlugin {
    store?: any | undefined;
    events?: any | undefined;
  }
  interface Window {
    corePlugin?: CorePlugin;
    coreAPI?: any | undefined;
    electronAPI?: any | undefined;
  }
}
