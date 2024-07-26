import { useCallback } from 'react'

import { LlmEngine, LocalEngines, Model } from '@janhq/core'

import { useQueryClient } from '@tanstack/react-query'

import { useAtomValue } from 'jotai'

import { HfModelEntry } from '@/utils/huggingface'

import { cortexHubModelsQueryKey } from './useModelHub'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const useGetModelsByEngine = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const queryClient = useQueryClient()

  // TODO: this function needs to be clean up
  const getModelsByEngine = useCallback(
    (engine: LlmEngine, searchText: string): Model[] => {
      if (LocalEngines.some((x) => x === engine)) {
        return downloadedModels
          .filter((m) => m.engine === engine)
          .filter((m) => {
            if (searchText.trim() === '') return true
            return (
              m.model?.toLowerCase().includes(searchText) ||
              m.name?.toLowerCase().includes(searchText)
            )
          })
      }

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
          m.model?.toLowerCase().includes(searchText) ||
          m.name?.toLowerCase().includes(searchText)
        )
      })
    },
    [queryClient, downloadedModels]
  )

  return { getModelsByEngine }
}

export default useGetModelsByEngine
