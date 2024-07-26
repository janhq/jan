import { useMutation, useQueryClient } from '@tanstack/react-query'

import useCortex, { EngineStatus } from './useCortex'
import { engineQueryKey } from './useEngineQuery'

const useEngineInit = () => {
  const { initializeEngine } = useCortex()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: initializeEngine,

    onSuccess: async (data, variables) => {
      console.debug(`Engine ${variables} initialized`, data)

      // optimistically set the engine status to 'ready'
      const queryCacheData = await queryClient.getQueryData(engineQueryKey)
      if (!queryCacheData) {
        return queryClient.invalidateQueries({ queryKey: engineQueryKey })
      }
      const engineStatuses = queryCacheData as EngineStatus[]
      engineStatuses.forEach((engine) => {
        if (engine.name === variables) {
          engine.status = 'ready'
        }
      })
      console.log(`Updated engine status: ${engineStatuses}`)
      await queryClient.setQueryData(engineQueryKey, engineStatuses)
    },

    onError(error, variables) {
      console.error(`Engine ${variables} failed to initialize`, error)
    },
  })
}

export default useEngineInit
