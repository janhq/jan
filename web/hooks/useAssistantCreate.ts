import { Assistant } from '@janhq/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { assistantQueryKey } from './useAssistantQuery'

import useCortex from './useCortex'

export const janAssistant: Assistant = {
  avatar: '',
  id: 'jan',
  object: 'assistant',
  created_at: Date.now(),
  name: 'Jan',
  description: 'A default assistant that can use all downloaded models',
  model: '*',
  instructions: '',
  tools: [
    // {
    //   type: 'retrieval',
    //   enabled: false,
    //   settings: {
    //     top_k: 2,
    //     chunk_size: 1024,
    //     chunk_overlap: 64,
    //     retrieval_template:
    //       "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.\n----------------\nCONTEXT: {CONTEXT}\n----------------\nQUESTION: {QUESTION}\n----------------\nHelpful Answer:",
    //   },
    // },
  ],
  metadata: undefined,
}

const useAssistantCreate = () => {
  const { createAssistant } = useCortex()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createAssistant,

    onSuccess(data) {
      queryClient.setQueryData(
        assistantQueryKey,
        (oldData: Assistant[] | undefined) => [...(oldData ?? []), data]
      )
    },

    onError(error, variables) {
      console.error(
        `Error while creating assistant: ${JSON.stringify(variables)}. Error: ${error}`
      )
    },
  })
}

export default useAssistantCreate
