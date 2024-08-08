import { useQuery } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

export const modelQueryKey = ['getModels']

const useModelQuery = () => {
  const { fetchModels } = useCortex()
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)

  return useQuery({
    queryKey: modelQueryKey,
    queryFn: async () => {
      const models = await fetchModels()
      setDownloadedModels(models)
      return models
    },
    staleTime: 30 * 1000,
  })
}

export default useModelQuery
