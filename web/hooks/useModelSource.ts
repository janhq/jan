import { useMemo } from 'react'

import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'
import useSWR from 'swr'

import { extensionManager } from '@/extension/ExtensionManager'

/**
 * @returns A Promise that resolves to an object of model sources.
 */
export function useGetModelSources() {
  const extension = useMemo(
    () => extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model),
    []
  )

  const {
    data: sources,
    error,
    mutate,
  } = useSWR(extension ? 'getSources' : null, () => extension?.getSources(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  })

  return { sources, error, mutate }
}

/**
 * Add a new model source
 * @returns A Promise that resolves to intall of engine.
 */
export const addModelSource = async (source: string) => {
  const extension = useMemo(
    () => extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model),
    []
  )

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    return await extension.addSource(source)
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}

/**
 * Delete a new model source
 * @returns A Promise that resolves to intall of engine.
 */
export const deleteModelSource = async (source: string) => {
  const extension = useMemo(
    () => extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model),
    []
  )

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    // Call the extension's method
    return await extension.deleteSource(source)
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}
