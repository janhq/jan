import { Assistant } from '@janhq/core'
import { useMutation } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import { setThreadMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { setActiveThreadIdAtom, threadsAtom } from '@/helpers/atoms/Thread.atom'

export type ThreadCreateMutationVariables = {
  modelId: string
  assistant: Assistant
  instructions?: string
}

const useThreadCreateMutation = () => {
  const { createThread } = useCortex()
  const setThreads = useSetAtom(threadsAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setThreadMessagesAtom)

  return useMutation({
    mutationFn: async (variables: ThreadCreateMutationVariables) => {
      const { assistant, modelId, instructions } = variables
      if (instructions) {
        assistant.instructions = instructions
      }

      return createThread({
        ...assistant,
        model: modelId,
      })
    },

    onSuccess: (thread, variables, context) => {
      console.log('New thread created', thread, variables, context)
      setThreads((threads) => [thread, ...threads])
      setActiveThreadId(thread.id)
      setThreadMessage(thread.id, [])
    },

    onError: (error, variables) => {
      console.error(
        `Failed to create new thread: ${JSON.stringify(variables)}, error: ${error}`
      )
      toaster({
        title: 'Failed to create thread',
        description: `Unexpected error while creating thread. Please try again!`,
        type: 'error',
      })
    },
  })
}

export default useThreadCreateMutation
