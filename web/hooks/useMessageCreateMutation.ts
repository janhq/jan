import { MessageCreateParams } from '@janhq/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import useCortex from './useCortex'
import { messageQueryKey } from './useMessageQuery'

export type MessageCreateMutationVariables = {
  threadId: string
  createMessageParams: MessageCreateParams
}

const useMessageCreateMutation = (params: MessageCreateMutationVariables) => {
  const { createMessage } = useCortex()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => createMessage(params),

    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...messageQueryKey, params.threadId],
      }),

    onError: (err, variables) => {
      console.error(
        `Failed to create message with variables: ${JSON.stringify(variables, null, 2)}, err: ${err}`
      )
    },
  })
}

export default useMessageCreateMutation
