import { useMutation } from '@tanstack/react-query'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

const useModelStart = () => {
  const { startModel } = useCortex()

  return useMutation({
    mutationFn: (modelId: string) => startModel(modelId),

    onSuccess: (data, variables) => {
      console.debug('Model started', variables, data)
    },

    onError: (error, variables) => {
      toaster({
        title: 'Failed to send message',
        description: `Failed to start model ${variables}. Please try again!`,
        type: 'error',
      })
      console.error('Failed to start model', variables, error)
    },
  })
}

export default useModelStart
