export enum ExtensionTypeEnum {
  Assistant = 'assistant',
  Conversational = 'conversational',
  Inference = 'inference',
  Model = 'model',
  SystemMonitoring = 'systemMonitoring',
  HuggingFace = 'huggingFace',
}

export interface ExtensionType {
  type(): ExtensionTypeEnum | undefined
}
/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 */
export abstract class BaseExtension implements ExtensionType {
  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension
   * Undefined means its not extending any known extension by the application.
   */
  type(): ExtensionTypeEnum | undefined {
    return undefined
  }
  /**
   * Called when the extension is loaded.
   * Any initialization logic for the extension should be put here.
   */
  abstract onLoad(): void
  /**
   * Called when the extension is unloaded.
   * Any cleanup logic for the extension should be put here.
   */
  abstract onUnload(): void
}
