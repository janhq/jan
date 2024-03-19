import { useCallback } from 'react'

import { fs, AppConfiguration, ModelEvent, events } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'

export default function useFactoryReset() {
  const defaultJanDataFolder = useAtomValue(defaultJanDataFolderAtom)

  const resetAll = useCallback(
    async (keepCurrentFolder?: boolean) => {
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
          quick_ask: appConfiguration?.quick_ask ?? false,
        }
        await window.core?.api?.updateAppConfiguration(configuration)
      }

      // stop nitro
      events.emit(ModelEvent.OnModelStop, {})
      // wait for sometimes
      await new Promise((resolve) => setTimeout(resolve, 2000))

      await fs.rm(janDataFolderPath)

      // reset the localStorage
      localStorage.clear()

      await window.core?.api?.relaunch()
    },
    [defaultJanDataFolder]
  )

  return {
    defaultJanDataFolder,
    resetAll,
  }
}
