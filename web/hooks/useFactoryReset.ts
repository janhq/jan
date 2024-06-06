import { useCallback } from 'react'

import { fs, AppConfiguration } from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'

import useModels from './useModels'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'
import { activeModelsAtom } from '@/helpers/atoms/Model.atom'

export enum FactoryResetState {
  Idle = 'idle',
  Starting = 'starting',
  StoppingModel = 'stopping_model',
  DeletingData = 'deleting_data',
  ClearLocalStorage = 'clear_local_storage',
}

export const factoryResetStateAtom = atom(FactoryResetState.Idle)

const useFactoryReset = () => {
  const defaultJanDataFolder = useAtomValue(defaultJanDataFolderAtom)
  const activeModels = useAtomValue(activeModelsAtom)

  const { stopModel } = useModels()
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
      for (const { model } of activeModels) {
        await stopModel(model)
      }

      await new Promise((resolve) => setTimeout(resolve, 4000))

      setFactoryResetState(FactoryResetState.DeletingData)
      await fs.rm(janDataFolderPath)

      setFactoryResetState(FactoryResetState.ClearLocalStorage)
      // reset the localStorage
      localStorage.clear()

      await window.core?.api?.relaunch()
    },
    [defaultJanDataFolder, activeModels, stopModel, setFactoryResetState]
  )

  return {
    resetAll,
  }
}

export default useFactoryReset
