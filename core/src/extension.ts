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

export interface Compatibility {
  platform: string[]
  version: string
}

const ALL_INSTALLATION_STATE = [
  'NotRequired', // not required.
  'Installed', // require and installed. Good to go.
  'NotInstalled', // require to be installed.
  'Corrupted', // require but corrupted. Need to redownload.
] as const

export type InstallationStateTuple = typeof ALL_INSTALLATION_STATE
export type InstallationState = InstallationStateTuple[number]

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

  /**
   * The compatibility of the extension.
   * This is used to check if the extension is compatible with the current environment.
   * @property {Array} platform
   */
  compatibility(): Compatibility | undefined {
    return undefined
  }

  /**
   * Determine if the prerequisites for the extension are installed.
   *
   * @returns {boolean} true if the prerequisites are installed, false otherwise.
   */
  async installationState(): Promise<InstallationState> {
    return 'NotRequired'
  }

  /**
   * Install the prerequisites for the extension.
   *
   * @returns {Promise<void>}
   */
  // @ts-ignore
  async install(...args): Promise<void> {
    return
  }
}
