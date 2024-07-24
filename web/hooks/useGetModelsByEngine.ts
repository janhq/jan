import { useCallback } from 'react'

import { LlmEngine, LocalEngines, Model, RemoteEngine } from '@janhq/core'

import { useQueryClient } from '@tanstack/react-query'

import { useAtomValue } from 'jotai'

import { HfModelEntry } from '@/utils/huggingface'

import useConfigQuery from './useConfigQuery'
import { cortexHubModelsQueryKey } from './useModelHub'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const useGetModelsByEngine = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const queryClient = useQueryClient()
  const { data: configData } = useConfigQuery()

  const hasApiKey = useCallback(
    (engine: RemoteEngine): boolean => {
      if (!configData) return false
      // @ts-expect-error engine is not null
      return (configData[engine ?? '']?.apiKey ?? '').length > 0
    },
    [configData]
  )

  // TODO: this function needs to be clean up
  const getModelsByEngine = useCallback(
    (engine: LlmEngine, searchText: string): Model[] => {
      if (LocalEngines.some((x) => x === engine)) {
        return downloadedModels
          .filter((m) => m.engine === engine)
          .filter((m) => {
            if (searchText.trim() === '') return true
            return (
              m.id?.toLowerCase().includes(searchText) ||
              m.model?.toLowerCase().includes(searchText) ||
              m.name?.toLowerCase().includes(searchText)
            )
          })
      }

      // if remote, we need to check if models have been configured
      const isConfigured = hasApiKey(engine as RemoteEngine)
      if (!isConfigured) return []

      const data = queryClient.getQueryData(cortexHubModelsQueryKey)
      if (!data) return []
      const modelEntries = data as HfModelEntry[]
      const models: Model[] = []
      for (const entry of modelEntries) {
        if (entry.model && entry.engine === engine) {
          models.push(entry.model)
        }
      }

      return models.filter((m) => {
        if (searchText.trim() === '') return true
        return (
          m.id?.toLowerCase().includes(searchText) ||
          m.model?.toLowerCase().includes(searchText) ||
          m.name?.toLowerCase().includes(searchText)
        )
      })
    },
    [queryClient, downloadedModels, hasApiKey]
  )

  return { getModelsByEngine }
}

export default useGetModelsByEngine
