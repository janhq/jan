export {};

declare global {
  interface CorePlugin {
    store?: any | undefined;
  }
  interface Window {
    corePlugin?: CorePlugin;
  }
}
