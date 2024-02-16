import { useEffect, useState } from 'react'

import { fs, AppConfiguration, joinPath, getUserHomePath } from '@janhq/core'

export default function useFactoryReset() {
  const [defaultJanDataFolder, setdefaultJanDataFolder] = useState('')

  useEffect(() => {
    async function getDefaultJanDataFolder() {
      const homePath = await getUserHomePath()
      const defaultJanDataFolder = await joinPath([homePath, 'jan'])
      setdefaultJanDataFolder(defaultJanDataFolder)
    }
    getDefaultJanDataFolder()
  }, [])

  const resetAll = async (keepCurrentFolder?: boolean) => {
    // read the place of jan data folder
    const appConfiguration: AppConfiguration | undefined =
      await window.core?.api?.getAppConfigurations()

    if (!appConfiguration) {
      console.debug('Failed to get app configuration')
    }

    console.debug('appConfiguration: ', appConfiguration)
    const janDataFolderPath = appConfiguration!.data_folder

    if (!keepCurrentFolder) {
      // set the default jan data folder to user's home directory
      const configuration: AppConfiguration = {
        data_folder: defaultJanDataFolder,
      }
      await window.core?.api?.updateAppConfiguration(configuration)
    }
    await fs.rmdirSync(janDataFolderPath, { recursive: true })

    // reset the localStorage
    localStorage.clear()

    await window.core?.api?.relaunch()
  }

  return {
    defaultJanDataFolder,
    resetAll,
  }
}
