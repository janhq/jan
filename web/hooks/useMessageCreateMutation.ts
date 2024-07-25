import { MessageCreateParams } from '@janhq/core'
import { useMutation } from '@tanstack/react-query'

import useCortex from './useCortex'

export type MessageCreateMutationVariables = {
  threadId: string
  createMessageParams: MessageCreateParams
}

const useMessageCreateMutation = () => {
  const { createMessage } = useCortex()

  return useMutation({
    mutationFn: (variables: MessageCreateMutationVariables) =>
      createMessage(variables),

    onSuccess: (data) => {
      console.debug(`Successfully created message: ${JSON.stringify(data)}`)
    },

    onError: (err, variables) => {
      console.error(
        `Failed to create message with variables: ${JSON.stringify(variables, null, 2)}, err: ${err}`
      )
    },
  })
}

export default useMessageCreateMutation
