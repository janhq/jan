export enum ExtensionType {
  Assistant = "assistant",
  Conversational = "conversational",
  Inference = "inference",
  Model = "model",
  SystemMonitoring = "systemMonitoring",
}

/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 */
export abstract class BaseExtension {
  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension
   * Undefined means its not extending any known extension by the application.
   */
  abstract type(): ExtensionType | undefined;
  /**
   * Called when the extension is loaded.
   * Any initialization logic for the extension should be put here.
   */
  abstract onLoad(): void;
  /**
   * Called when the extension is unloaded.
   * Any cleanup logic for the extension should be put here.
   */
  abstract onUnload(): void;
}
