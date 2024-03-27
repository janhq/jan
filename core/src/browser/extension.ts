import { SettingComponentProps } from '../types'
import { getJanDataFolderPath, joinPath } from './core'
import { fs } from './fs'

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
  'Updatable', // require and installed but need to be updated.
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
  protected settingFolderName = 'settings'
  protected settingFileName = 'settings.json'

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
   * Determine if the extension is updatable.
   */
  updatable(): boolean {
    return false
  }

  extensionName(): string | undefined {
    return undefined
  }

  async registerSettings(settings: SettingComponentProps[]): Promise<void> {
    const extensionName = this.extensionName()
    if (!extensionName) {
      console.error('Extension name is not defined')
      return
    }

    const extensionSettingFolderPath = await joinPath([
      await getJanDataFolderPath(),
      'settings',
      extensionName,
    ])

    try {
      await fs.mkdir(extensionSettingFolderPath)
      const settingFilePath = await joinPath([extensionSettingFolderPath, this.settingFileName])

      if (await fs.existsSync(settingFilePath)) return
      await fs.writeFileSync(settingFilePath, JSON.stringify(settings, null, 2))
    } catch (err) {
      console.error(err)
    }
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

  async getSettings(): Promise<SettingComponentProps[]> {
    const extensionName = this.extensionName()
    if (!extensionName) return []

    const settingPath = await joinPath([
      await getJanDataFolderPath(),
      this.settingFolderName,
      this.extensionName()!,
      this.settingFileName,
    ])

    try {
      const content = await fs.readFileSync(settingPath, 'utf-8')
      const settings: SettingComponentProps[] = JSON.parse(content)
      return settings
    } catch (err) {
      console.warn(err)
      return []
    }
  }

  async updateSettings(componentProps: Partial<SettingComponentProps>[]): Promise<void> {
    const extensionName = this.extensionName()
    if (!extensionName) return

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
      extensionName,
      this.settingFileName,
    ])

    await fs.writeFileSync(settingPath, JSON.stringify(updatedSettings, null, 2))
  }
}
