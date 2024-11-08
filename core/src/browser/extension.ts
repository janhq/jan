import { Model, ModelEvent, SettingComponentProps } from '../types'
import { getJanDataFolderPath, joinPath } from './core'
import { events } from './events'
import { fs } from './fs'
import { ModelManager } from './models'

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
  'NotCompatible', // require but not compatible.
] as const

export type InstallationStateTuple = typeof ALL_INSTALLATION_STATE
export type InstallationState = InstallationStateTuple[number]

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
    events.emit(ModelEvent.OnModelsUpdate, {})
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

    const extensionSettingFolderPath = await joinPath([
      await getJanDataFolderPath(),
      'settings',
      this.name,
    ])
    settings.forEach((setting) => {
      setting.extensionName = this.name
    })
    try {
      if (!(await fs.existsSync(extensionSettingFolderPath)))
        await fs.mkdir(extensionSettingFolderPath)
      const settingFilePath = await joinPath([extensionSettingFolderPath, this.settingFileName])

      // Persists new settings
      if (await fs.existsSync(settingFilePath)) {
        const oldSettings = JSON.parse(await fs.readFileSync(settingFilePath, 'utf-8'))
        settings.forEach((setting) => {
          // Keep setting value
          if (setting.controllerProps && Array.isArray(oldSettings))
            setting.controllerProps.value = oldSettings.find(
              (e: any) => e.key === setting.key
            )?.controllerProps?.value
        })
      }
      await fs.writeFileSync(settingFilePath, JSON.stringify(settings, null, 2))
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
  async install(): Promise<void> {
    return
  }

  /**
   * Get the settings for the extension.
   * @returns
   */
  async getSettings(): Promise<SettingComponentProps[]> {
    if (!this.name) return []

    const settingPath = await joinPath([
      await getJanDataFolderPath(),
      this.settingFolderName,
      this.name,
      this.settingFileName,
    ])

    try {
      if (!(await fs.existsSync(settingPath))) return []
      const content = await fs.readFileSync(settingPath, 'utf-8')
      const settings: SettingComponentProps[] = JSON.parse(content)
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

    const updatedSettings = settings.map((setting) => {
      const updatedSetting = componentProps.find(
        (componentProp) => componentProp.key === setting.key
      )
      if (updatedSetting && updatedSetting.controllerProps) {
        setting.controllerProps.value = updatedSetting.controllerProps.value
      }
      return setting
    })

    const settingPath = await joinPath([
      await getJanDataFolderPath(),
      this.settingFolderName,
      this.name,
      this.settingFileName,
    ])

    await fs.writeFileSync(settingPath, JSON.stringify(updatedSettings, null, 2))

    updatedSettings.forEach((setting) => {
      this.onSettingUpdate<typeof setting.controllerProps.value>(
        setting.key,
        setting.controllerProps.value
      )
    })
  }
}
