export {};

declare global {
  interface Window {
    electronAPI?: any | undefined;
    corePlugin?: any | undefined;
  }
}
