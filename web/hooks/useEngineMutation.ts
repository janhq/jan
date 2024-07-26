import { RemoteEngine } from '@janhq/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import { engineQueryKey } from './useEngineQuery'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

export type UpdateConfigMutationVariables = {
  engine: RemoteEngine
  config: { config: string; value: string }
}

const useEngineMutation = () => {
  const { registerEngineConfig } = useCortex()
  const queryClient = useQueryClient()

  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  return useMutation({
    mutationFn: registerEngineConfig,

    onError: (err, variables) => {
      console.error(
        `Failed to register engine with variables: ${variables}, err: ${err}`
      )
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: engineQueryKey })
      setUpRemoteModelStage('NONE', undefined)
      toaster({
        title: 'Success!',
        description: `Key added successfully`,
        type: 'success',
      })
    },
  })
}

export default useEngineMutation
