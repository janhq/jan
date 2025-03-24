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
  } = useSWR(
    extension ? 'getSources' : null,
    () =>
      extension?.getSources().then((e) =>
        e.map((m) => ({
          ...m,
          models: m.models.sort((a, b) => a.size - b.size),
        }))
      ),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { sources, error, mutate }
}

/**
 * @returns A Promise that resolves to featured model sources.
 */
export function useGetFeaturedSources() {
  const { sources, error, mutate } = useGetModelSources()

  return {
    sources: sources?.filter((e) => e.metadata?.tags?.includes('featured')),
    error,
    mutate,
  }
}

/**
 * @returns A Promise that resolves to model source mutation.
 */
export const useModelSourcesMutation = () => {
  const extension = useMemo(
    () => extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model),
    []
  )
  /**
   * Add a new model source
   * @returns A Promise that resolves to intall of engine.
   */
  const addModelSource = async (source: string) => {
    try {
      // Call the extension's method
      return await extension?.addSource(source)
    } catch (error) {
      console.error('Failed to install engine variant:', error)
      throw error
    }
  }

  /**
   * Delete a new model source
   * @returns A Promise that resolves to intall of engine.
   */
  const deleteModelSource = async (source: string) => {
    try {
      // Call the extension's method
      return await extension?.deleteSource(source)
    } catch (error) {
      console.error('Failed to install engine variant:', error)
      throw error
    }
  }
  return { addModelSource, deleteModelSource }
}
