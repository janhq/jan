import { Engine } from '@cortexso/cortex.js/resources'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import useCortex from './useCortex'
import { engineQueryKey } from './useEngineQuery'

const useEngineInit = () => {
  const { initializeEngine } = useCortex()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: initializeEngine,

    onSuccess: async (data, engineName) => {
      console.debug(`Engine ${engineName} initialized`, data)

      // optimistically set the engine status to 'ready'
      const queryCacheData = await queryClient.getQueryData(engineQueryKey)
      if (!queryCacheData) {
        return queryClient.invalidateQueries({ queryKey: engineQueryKey })
      }
      const engineStatuses = queryCacheData as Engine[]
      engineStatuses.forEach((engine) => {
        if (engine.name === engineName) {
          engine.status = 'ready'
        }
      })
      console.debug(`Updated engine status: ${engineStatuses}`)
      await queryClient.setQueryData(engineQueryKey, engineStatuses)
    },

    onError(error, variables) {
      console.error(`Engine ${variables} failed to initialize`, error)
    },
  })
}

export default useEngineInit
