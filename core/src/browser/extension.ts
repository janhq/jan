import { Model, SettingComponentProps } from '../types'
import { ModelManager } from './models'

export enum ExtensionTypeEnum {
  Assistant = 'assistant',
  Conversational = 'conversational',
  Inference = 'inference',
  Model = 'model',
  SystemMonitoring = 'systemMonitoring',
  MCP = 'mcp',
  HuggingFace = 'huggingFace',
  Engine = 'engine',
  Hardware = 'hardware',
  RAG = 'rag',
  VectorDB = 'vectorDB',
}

export interface ExtensionType {
  type(): ExtensionTypeEnum | undefined
}

export interface Compatibility {
  platform: string[]
  version: string
}

/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 */
export abstract class BaseExtension implements ExtensionType {
  protected settingFolderName = 'settings'
  protected settingFileName = 'settings.json'

  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product Name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active

  /** @type {string} Extension's description. */
  description

  /** @type {string} Extension's version. */
  version

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
  }

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
   * Registers models - it persists in-memory shared ModelManager instance's data map.
   * @param models
   */
  async registerModels(models: Model[]): Promise<void> {
    for (const model of models) {
      ModelManager.instance().register(model)
    }
  }

  /**
   * Register settings for the extension.
   * @param settings
   * @returns
   */
  async registerSettings(settings: SettingComponentProps[]): Promise<void> {
    if (!this.name) {
      console.error('Extension name is not defined')
      return
    }

    settings.forEach((setting) => {
      setting.extensionName = this.name
    })
    try {
      const oldSettingsJson = localStorage.getItem(this.name)
      // Persists new settings
      if (oldSettingsJson) {
        const oldSettings = JSON.parse(oldSettingsJson)
        settings.forEach((setting) => {
          // Keep setting value
          if (setting.controllerProps && Array.isArray(oldSettings))
            setting.controllerProps.value =
              oldSettings.find((e: any) => e.key === setting.key)?.controllerProps?.value ??
              setting.controllerProps.value
          if ('options' in setting.controllerProps) {
            setting.controllerProps.options = setting.controllerProps.options?.length
              ? setting.controllerProps.options
              : oldSettings.find((e: any) => e.key === setting.key)?.controllerProps?.options
            if(!setting.controllerProps.options?.some(e => e.value === setting.controllerProps.value)) {
              setting.controllerProps.value = setting.controllerProps.options?.[0]?.value ?? setting.controllerProps.value
            }
          }
          if ('recommended' in setting.controllerProps) {
            const oldRecommended = oldSettings.find((e: any) => e.key === setting.key)
              ?.controllerProps?.recommended
            if (oldRecommended !== undefined && oldRecommended !== '') {
              setting.controllerProps.recommended = oldRecommended
            }
          }
        })
      }
      localStorage.setItem(this.name, JSON.stringify(settings))
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Get the setting value for the key.
   * @param key
   * @param defaultValue
   * @returns
   */
  async getSetting<T>(key: string, defaultValue: T) {
    const keySetting = (await this.getSettings()).find((setting) => setting.key === key)

    const value = keySetting?.controllerProps.value
    return (value as T) ?? defaultValue
  }

  onSettingUpdate<T>(key: string, value: T) {
    return
  }

  /**
   * Install the prerequisites for the extension.
   *
   * @returns {Promise<void>}
   */
  async install(): Promise<void> {
    return
  }

  /**
   * Get the settings for the extension.
   * @returns
   */
  async getSettings(): Promise<SettingComponentProps[]> {
    if (!this.name) return []

    try {
      const settingsString = localStorage.getItem(this.name)
      if (!settingsString) return []
      const settings: SettingComponentProps[] = JSON.parse(settingsString)
      return settings
    } catch (err) {
      console.warn(err)
      return []
    }
  }

  /**
   * Update the settings for the extension.
   * @param componentProps
   * @returns
   */
  async updateSettings(componentProps: Partial<SettingComponentProps>[]): Promise<void> {
    if (!this.name) return

    const settings = await this.getSettings()

    let updatedSettings = settings.map((setting) => {
      const updatedSetting = componentProps.find(
        (componentProp) => componentProp.key === setting.key
      )
      if (updatedSetting && updatedSetting.controllerProps) {
        setting.controllerProps.value = updatedSetting.controllerProps.value
      }
      return setting
    })

    if (!updatedSettings.length) updatedSettings = componentProps as SettingComponentProps[]

    localStorage.setItem(this.name, JSON.stringify(updatedSettings))

    updatedSettings.forEach((setting) => {
      this.onSettingUpdate<typeof setting.controllerProps.value>(
        setting.key,
        setting.controllerProps.value
      )
    })
  }
}
