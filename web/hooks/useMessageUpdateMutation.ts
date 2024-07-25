import { useMutation } from '@tanstack/react-query'

import useCortex from './useCortex'

export type MessageUpdateMutationVariables = {
  threadId: string
  messageId: string
  data: object
}

const useMessageUpdateMutation = () => {
  const { updateMessage } = useCortex()

  return useMutation({
    mutationFn: (variables: MessageUpdateMutationVariables) =>
      updateMessage(variables),

    onSuccess: (data) => {
      console.debug(`Successfully updated message: ${JSON.stringify(data)}`)
    },

    onError: (err, variables) => {
      console.error(
        `Failed to update message with variables: ${JSON.stringify(variables, null, 2)}, err: ${err}`
      )
    },
  })
}

export default useMessageUpdateMutation
