import { useCallback, useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  events,
  ModelManager,
  EngineEvent,
  EngineManagementExtension,
  Engines,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { extensionManager } from '@/extension'

import { installedEnginesAtom } from '@/helpers/atoms/Engines.atom'

/**
 * useModels hook - Handles the state of models
 * It fetches the downloaded models, configured models and default model from Model Extension
 * and updates the atoms accordingly.
 */
const useEngines = () => {
  const setInstalledEngines = useSetAtom(installedEnginesAtom)

  const getData = useCallback(() => {
    getEngines().then(setInstalledEngines)
  }, [setInstalledEngines])

  const reloadData = useDebouncedCallback(() => getData(), 300)

  const getEngines = async (): Promise<Engines> =>
    extensionManager
      .get<EngineManagementExtension>(ExtensionTypeEnum.Engine)
      ?.getEngines()
      .catch(() => ({}) as Engines) ?? ({} as Engines)

  useEffect(() => {
    // Listen for engine updates
    events.on(EngineEvent.OnEngineUpdate, reloadData)
    return () => {
      // Remove listener on unmount
      events.off(EngineEvent.OnEngineUpdate, reloadData)
    }
  }, [reloadData])

  return {
    getData,
  }
}

export default useEngines
