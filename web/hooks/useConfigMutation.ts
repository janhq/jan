import { RemoteEngine } from '@janhq/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { cortexConfigQueryKey } from './useConfigQuery'

import useCortex from './useCortex'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

export type UpdateConfigMutationVariables = {
  engine: RemoteEngine
  config: { key: string; value: string; name: string }
}

const useConfigMutation = () => {
  const { registerEngineConfig } = useCortex()
  const queryClient = useQueryClient()

  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  return useMutation({
    mutationFn: registerEngineConfig,

    onError: (err, variables, _context) => {
      console.error(
        `Failed to register engine with variables: ${variables}, err: ${err}`
      )
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cortexConfigQueryKey })
      setUpRemoteModelStage('NONE', undefined)
      toaster({
        title: 'Success!',
        description: `Key added successfully`,
        type: 'success',
      })
    },
  })
}

export default useConfigMutation
