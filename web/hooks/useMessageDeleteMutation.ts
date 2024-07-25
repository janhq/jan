import { useMutation } from '@tanstack/react-query'

import useCortex from './useCortex'

export type MessageDeleteMutationVariables = {
  threadId: string
  messageId: string
}

const useMessageDeleteMutation = () => {
  const { deleteMessage } = useCortex()

  return useMutation({
    mutationFn: (variables: MessageDeleteMutationVariables) =>
      deleteMessage(variables),

    onSuccess: (_data, variables) => {
      console.debug(
        `Successfully deleted message: ${JSON.stringify(variables)}`
      )
    },

    onError: (variables, err) => {
      console.error(
        `Failed to delete message: ${JSON.stringify(variables)}, err: ${err}`
      )
    },
  })
}

export default useMessageDeleteMutation
