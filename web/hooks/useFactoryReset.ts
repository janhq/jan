import { fs, AppConfiguration, joinPath, getUserHomePath } from '@janhq/core'

export default function useFactoryReset() {
  const resetAll = async () => {
    // read the place of jan data folder
    const appConfiguration: AppConfiguration | undefined =
      await window.core?.api?.getAppConfigurations()

    if (!appConfiguration) {
      console.debug('Failed to get app configuration')
    }

    console.debug('appConfiguration: ', appConfiguration)
    const janDataFolderPath = appConfiguration!.data_folder

    const homePath = await getUserHomePath()
    console.log(homePath)

    const defaultJanDataFolder = await joinPath([homePath, 'jan'])
    if (defaultJanDataFolder === janDataFolderPath) {
      console.debug('Jan data folder is already at user home')
    } else {
      // if jan data folder is not at user home, we update the app configuration to point to user home
      const configuration: AppConfiguration = {
        data_folder: defaultJanDataFolder,
      }

      await window.core?.api?.updateAppConfiguration(configuration)
    }

    const modelPath = await joinPath([janDataFolderPath, 'models'])
    const threadPath = await joinPath([janDataFolderPath, 'threads'])

    console.debug(`Removing models at ${modelPath}`)
    await fs.rmdirSync(modelPath, { recursive: true })

    console.debug(`Removing threads at ${threadPath}`)
    await fs.rmdirSync(threadPath, { recursive: true })

    // reset the localStorage
    localStorage.clear()

    await window.core?.api?.relaunch()
  }

  return {
    resetAll,
  }
}
