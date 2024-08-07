import { useMutation } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'
import { addDownloadModelStateAtom } from './useDownloadState'

export type DownloadModelMutationVariables = {
  modelId: string
  fileName?: string
  persistedModelId?: string
}

const useModelDownloadMutation = () => {
  const { downloadModel } = useCortex()
  const addDownloadState = useSetAtom(addDownloadModelStateAtom)

  return useMutation({
    mutationFn: downloadModel,

    onMutate: (variables) => {
      console.debug('Downloading model', variables)
    },

    onSuccess: (data, variables) => {
      console.debug('Download response success', data, variables)

      const { persistedModelId, modelId } = variables
      if (persistedModelId) {
        addDownloadState(persistedModelId)
      } else {
        addDownloadState(modelId)
      }
    },

    onError: (err, variables) => {
      console.error('Failed to download model', err, variables)
      toaster({
        title: 'Failed to download model',
        description: err.message,
        type: 'error',
      })
    },
  })
}

export default useModelDownloadMutation
