import { useCallback } from 'react'

import { fs, AppConfiguration } from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'

import { useActiveModel } from './useActiveModel'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'

export enum FactoryResetState {
  Idle = 'idle',
  Starting = 'starting',
  StoppingModel = 'stopping_model',
  DeletingData = 'deleting_data',
  ClearLocalStorage = 'clear_local_storage',
}

export const factoryResetStateAtom = atom(FactoryResetState.Idle)

export default function useFactoryReset() {
  const defaultJanDataFolder = useAtomValue(defaultJanDataFolderAtom)
  const { stopModel } = useActiveModel()
  const setFactoryResetState = useSetAtom(factoryResetStateAtom)

  const resetAll = useCallback(
    async (keepCurrentFolder?: boolean) => {
      setFactoryResetState(FactoryResetState.Starting)
      // read the place of jan data folder
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      if (!appConfiguration) {
        console.debug('Failed to get app configuration')
      }

      const janDataFolderPath = appConfiguration!.data_folder

      if (!keepCurrentFolder) {
        // set the default jan data folder to user's home directory
        const configuration: AppConfiguration = {
          data_folder: defaultJanDataFolder,
          quick_ask: appConfiguration?.quick_ask ?? false,
        }
        await window.core?.api?.updateAppConfiguration(configuration)
      }

      setFactoryResetState(FactoryResetState.StoppingModel)
      await stopModel()
      await new Promise((resolve) => setTimeout(resolve, 4000))

      setFactoryResetState(FactoryResetState.DeletingData)
      await fs.rm(janDataFolderPath)

      setFactoryResetState(FactoryResetState.ClearLocalStorage)
      // reset the localStorage
      localStorage.clear()

      await window.core?.api?.relaunch()
    },
    [defaultJanDataFolder, stopModel, setFactoryResetState]
  )

  return {
    resetAll,
  }
}
