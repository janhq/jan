import { useCallback, useMemo, useState } from 'react'

import {
  ExtensionTypeEnum,
  EngineManagementExtension,
  InferenceEngine,
  EngineReleased,
  EngineConfig,
  events,
  EngineEvent,
  Model,
  ModelEvent,
  ModelSource,
  ModelSibling,
} from '@janhq/core'
import { useAtom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import useSWR from 'swr'

import { getDescriptionByEngine, getTitleByEngine } from '@/utils/modelEngine'

import { extensionManager } from '@/extension/ExtensionManager'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

export const releasedEnginesCacheAtom = atomWithStorage<{
  data: EngineReleased[]
  timestamp: number
} | null>('releasedEnginesCache', null, undefined, { getOnInit: true })

export const releasedEnginesLatestCacheAtom = atomWithStorage<{
  data: EngineReleased[]
  timestamp: number
} | null>('releasedEnginesLatestCache', null, undefined, { getOnInit: true })

export interface RemoteModelList {
  data?: {
    id?: string
    name?: string
  }[]
}

// fetcher function
async function fetchExtensionData<T>(
  extension: EngineManagementExtension | null,
  method: (extension: EngineManagementExtension) => Promise<T>
): Promise<T> {
  if (!extension) {
    throw new Error('Extension not found')
  }
  return method(extension)
}

/**
 * @returns A Promise that resolves to an object of list engines.
 */
export function useGetEngines() {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(
        ExtensionTypeEnum.Engine
      ) ?? null,
    []
  )

  const {
    data: engines,
    error,
    mutate,
  } = useSWR(
    extension ? 'engines' : null,
    () => fetchExtensionData(extension, (ext) => ext.getEngines()),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { engines, error, mutate }
}

/**
 * @returns A Promise that resolves to an object of remote models.
 */
export function useGetRemoteModels(name: string) {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(
        ExtensionTypeEnum.Engine
      ) ?? null,
    []
  )

  const {
    data: remoteModels,
    error,
    mutate,
  } = useSWR(
    extension ? `remoteModels_${name}` : null,
    () =>
      fetchExtensionData(
        extension,
        (ext) => ext.getRemoteModels(name) as Promise<RemoteModelList>
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { remoteModels, error, mutate }
}

/**
 * @param name - Inference engine name.
 * @returns A Promise that resolves to an array of installed engine.
 */
export function useGetInstalledEngines(name: InferenceEngine) {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(
        ExtensionTypeEnum.Engine
      ) ?? null,
    []
  )

  const {
    data: installedEngines,
    error,
    mutate,
  } = useSWR(
    extension ? 'installedEngines' : null,
    () => fetchExtensionData(extension, (ext) => ext.getInstalledEngines(name)),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { installedEngines, error, mutate }
}

/**
 * @param name - Inference engine name.
 * @param version - Version of the engine.
 * @param platform - Optional to sort by operating system. macOS, linux, windows.
 * @returns A Promise that resolves to an array of latest released engine by version.
 */
export function useGetReleasedEnginesByVersion(
  engine: InferenceEngine,
  version: string | undefined,
  platform: string
) {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(
        ExtensionTypeEnum.Engine
      ) ?? null,
    []
  )

  const [cache, setCache] = useAtom(releasedEnginesCacheAtom)

  const shouldFetch = Boolean(extension && version)

  const fetcher = async () => {
    const now = Date.now()
    const fifteenMinutes = 15 * 60 * 1000
    if (cache && cache.timestamp + fifteenMinutes > now) {
      return cache.data // Use cached data
    }

    const newData = await fetchExtensionData(extension, (ext) =>
      ext.getReleasedEnginesByVersion(engine, version!, platform)
    )

    setCache({ data: newData, timestamp: now })
    return newData
  }

  const { data, error, mutate } = useSWR(
    shouldFetch
      ? `releasedEnginesByVersion-${engine}-${version}-${platform}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return {
    releasedEnginesByVersion: data,
    error,
    mutate,
  }
}

/**
 * @param name - Inference engine name.
 * @param platform - Optional to sort by operating system. macOS, linux, windows.
 * @returns A Promise that resolves to an array of latest released engine.
 */

export function useGetLatestReleasedEngine(
  engine: InferenceEngine,
  platform: string
) {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(
        ExtensionTypeEnum.Engine
      ) ?? null,
    []
  )

  const [cache, setCache] = useAtom(releasedEnginesLatestCacheAtom)

  const fetcher = async () => {
    const now = Date.now()
    const fifteenMinutes = 15 * 60 * 1000

    if (cache && cache.timestamp + fifteenMinutes > now) {
      return cache.data // Use cached data
    }

    const newData = await fetchExtensionData(extension, (ext) =>
      ext.getLatestReleasedEngine(engine, platform)
    )

    setCache({ data: newData, timestamp: now })
    return newData
  }

  const { data, error, mutate } = useSWR(
    extension ? 'latestReleasedEngine' : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return {
    latestReleasedEngine: data,
    error,
    mutate,
  }
}

/**
 * @param name - Inference engine name.
 * @returns A Promise that resolves to an object of default engine.
 */
export function useGetDefaultEngineVariant(name: InferenceEngine) {
  const extension = useMemo(
    () =>
      extensionManager.get<EngineManagementExtension>(ExtensionTypeEnum.Engine),
    []
  )

  const {
    data: defaultEngineVariant,
    error,
    mutate,
  } = useSWR(
    extension ? 'defaultEngineVariant' : null,
    () =>
      fetchExtensionData(extension ?? null, (ext) =>
        ext.getDefaultEngineVariant(name)
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { defaultEngineVariant, error, mutate }
}

const getExtension = () =>
  extensionManager.get<EngineManagementExtension>(ExtensionTypeEnum.Engine) ??
  null

/**
 * @body variant - string
 * @body version - string
 * @returns A Promise that resolves to set default engine.
 */
export const setDefaultEngineVariant = async (
  name: InferenceEngine,
  engineConfig: { variant: string; version: string }
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.setDefaultEngineVariant(name, engineConfig)
    return response
  } catch (error) {
    console.error('Failed to set default engine variant:', error)
    throw error
  }
}

/**
 * @body variant - string
 * @body version - string
 * @returns A Promise that resolves to set default engine.
 */
export const updateEngine = async (
  name: InferenceEngine,
  engineConfig?: EngineConfig
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.updateEngine(name, engineConfig)
    events.emit(EngineEvent.OnEngineUpdate, {})
    return response
  } catch (error) {
    console.error('Failed to set default engine variant:', error)
    throw error
  }
}

/**
 * @param name - Inference engine name.
 * @returns A Promise that resolves to intall of engine.
 */
export const installEngine = async (
  name: string,
  engineConfig: EngineConfig
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.installEngine(name, engineConfig)
    events.emit(EngineEvent.OnEngineUpdate, {})
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}

/**
 * Add a new remote engine
 * @returns A Promise that resolves to intall of engine.
 */
export const addRemoteEngine = async (engineConfig: EngineConfig) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.addRemoteEngine(engineConfig)
    events.emit(EngineEvent.OnEngineUpdate, {})
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}

/**
 * @param name - Inference engine name.
 * @returns A Promise that resolves to unintall of engine.
 */
export const uninstallEngine = async (
  name: InferenceEngine,
  engineConfig: EngineConfig
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.uninstallEngine(name, engineConfig)
    events.emit(EngineEvent.OnEngineUpdate, {})
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}

/**
 * Add a new remote engine model
 * @param name
 * @param engine
 * @returns
 */
export const addRemoteEngineModel = async (name: string, engine: string) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.addRemoteModel({
      id: name,
      model: name,
      engine: engine as InferenceEngine,
    } as unknown as Model)
    events.emit(ModelEvent.OnModelsUpdate, { fetch: true })
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}

/**
 * Remote model sources
 * @returns A Promise that resolves to an object of model sources.
 */
export const useGetEngineModelSources = () => {
  const { engines } = useGetEngines()
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  return {
    sources: Object.entries(engines ?? {})
      ?.filter((e) => e?.[1]?.[0]?.type === 'remote')
      .map(
        ([key, values]) =>
          ({
            id: key,
            models: (
              downloadedModels.filter((e) => e.engine === values[0]?.engine) ??
              []
            ).map(
              (e) =>
                ({
                  id: e.id,
                  size: e.metadata?.size,
                }) as unknown as ModelSibling
            ),
            metadata: {
              id: getTitleByEngine(key as InferenceEngine),
              description: getDescriptionByEngine(key as InferenceEngine),
              apiKey: values[0]?.api_key,
            },
            type: 'cloud',
          }) as unknown as ModelSource
      ),
  }
}

/**
 * Refresh model list
 * @param engine
 * @returns
 */
export const useRefreshModelList = (engine: string) => {
  const [refreshingModels, setRefreshingModels] = useState(false)
  const { mutate: fetchRemoteModels } = useGetRemoteModels(engine)

  const refreshModels = useCallback(
    (engine: string) => {
      setRefreshingModels(true)
      fetchRemoteModels()
        .then((remoteModelList) =>
          Promise.all(
            remoteModelList?.data?.map((model: { id?: string }) =>
              model?.id
                ? addRemoteEngineModel(model.id, engine).catch(() => {})
                : {}
            ) ?? []
          )
        )
        .finally(() => setRefreshingModels(false))
    },
    [fetchRemoteModels]
  )

  return { refreshingModels, refreshModels }
}
