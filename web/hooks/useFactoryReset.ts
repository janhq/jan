import { useCallback } from 'react'

import { EngineManager } from '@janhq/core'
import { atom, useSetAtom } from 'jotai'

import { useActiveModel } from './useActiveModel'

export enum FactoryResetState {
  Idle = 'idle',
  Starting = 'starting',
  StoppingModel = 'stopping_model',
  DeletingData = 'deleting_data',
  ClearLocalStorage = 'clear_local_storage',
}

export const factoryResetStateAtom = atom(FactoryResetState.Idle)

export default function useFactoryReset() {
  const { stopModel } = useActiveModel()
  const setFactoryResetState = useSetAtom(factoryResetStateAtom)

  const resetAll = useCallback(async () => {
    setFactoryResetState(FactoryResetState.Starting)

    // 1: Stop running model
    setFactoryResetState(FactoryResetState.StoppingModel)
    await stopModel()

    await Promise.all(
      EngineManager.instance()
        .engines.values()
        .map(async (engine) => {
          await engine.onUnload()
        })
    )

    await new Promise((resolve) => setTimeout(resolve, 4000))

    // 2: Delete the old jan data folder
    setFactoryResetState(FactoryResetState.DeletingData)
    // Perform factory reset
    await window.core?.api?.factoryReset()

    // 4: Clear app local storage
    setFactoryResetState(FactoryResetState.ClearLocalStorage)
    // reset the localStorage
    localStorage.clear()

    window.core = undefined
    // 5: Relaunch the app
    window.location.reload()
  }, [stopModel, setFactoryResetState])

  return {
    resetAll,
  }
}
