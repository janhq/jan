import { useMemo } from 'react'

import {
  ExtensionTypeEnum,
  EngineManagementExtension,
  InferenceEngine,
  EngineReleased,
} from '@janhq/core'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import useSWR from 'swr'

import { extensionManager } from '@/extension/ExtensionManager'

export const releasedEnginesCacheAtom = atomWithStorage<{
  data: EngineReleased[]
  timestamp: number
} | null>('releasedEnginesCache', null, undefined, { getOnInit: true })

export const releasedEnginesLatestCacheAtom = atomWithStorage<{
  data: EngineReleased[]
  timestamp: number
} | null>('releasedEnginesLatestCache', null, undefined, { getOnInit: true })

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
export const updateEngine = async (name: InferenceEngine) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.updateEngine(name)
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
  name: InferenceEngine,
  engineConfig: { variant: string; version?: string }
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.installEngine(name, engineConfig)
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
  engineConfig: { variant: string; version: string }
) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    const response = await extension.uninstallEngine(name, engineConfig)
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}
