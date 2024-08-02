import { useMutation } from '@tanstack/react-query'

import useCortex from './useCortex'

const useModelStop = () => {
  const { stopModel } = useCortex()

  return useMutation({
    mutationFn: stopModel,

    onSuccess: (data, modelId) => {
      console.debug(`Model ${modelId} stopped successfully`, data)
    },

    onError: (error, modelId) => {
      console.debug(`Stop model ${modelId} error`, error)
    },
  })
}

export default useModelStop
