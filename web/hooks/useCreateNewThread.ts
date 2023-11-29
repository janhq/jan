import {
  Assistant,
  Thread,
  ThreadAssistantInfo,
  ThreadState,
} from '@janhq/core/lib/types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { generateThreadId } from '@/utils/conversation'

import {
  threadsAtom,
  setActiveThreadIdAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Conversation.atom'

const createNewThreadAtom = atom(null, (get, set, newThread: Thread) => {
  // create thread state for this new thread
  const currentState = { ...get(threadStatesAtom) }

  const threadState: ThreadState = {
    hasMore: false,
    waitingForResponse: false,
  }
  currentState[newThread.id] = threadState
  set(threadStatesAtom, currentState)

  // add the new thread on top of the thread list to the state
  const threads = get(threadsAtom)
  set(threadsAtom, [newThread, ...threads])
})

export const useCreateNewThread = () => {
  const createNewThread = useSetAtom(createNewThreadAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const [threadStates, setThreadStates] = useAtom(threadStatesAtom)
  const threads = useAtomValue(threadsAtom)

  const requestCreateNewThread = async (assistant: Assistant) => {
    const unfinishedThreads = threads.filter((t) => t.isFinishInit === false)
    if (unfinishedThreads.length > 0) {
      return
    }

    const createdAt = Date.now()
    const assistantInfo: ThreadAssistantInfo = {
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      model: {
        id: '*',
        settings: {
          ctx_len: 0,
          ngl: 0,
          embedding: false,
          n_parallel: 0,
        },
        parameters: {
          temperature: 0,
          token_limit: 0,
          top_k: 0,
          top_p: 0,
          stream: false,
        },
      },
    }
    const threadId = generateThreadId(assistant.id)
    const thread: Thread = {
      id: threadId,
      object: 'thread',
      title: 'New Thread',
      assistants: [assistantInfo],
      created: createdAt,
      updated: createdAt,
      isFinishInit: false,
    }

    // TODO: move isFinishInit here
    const threadState: ThreadState = {
      hasMore: false,
      waitingForResponse: false,
      lastMessage: undefined,
    }
    setThreadStates({ ...threadStates, [threadId]: threadState })
    // add the new thread on top of the thread list to the state
    createNewThread(thread)
    setActiveThreadId(thread.id)
  }

  return {
    requestCreateNewThread,
  }
}
