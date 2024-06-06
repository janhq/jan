import { useCallback } from 'react'

import { Assistant } from '@janhq/core'
import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

const janAssistant: Assistant = {
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

const useAssistants = () => {
  const setAssistants = useSetAtom(assistantsAtom)
  const { fetchAssistants, createAssistant: cortexCreateAssistant } =
    useCortex()

  const getAssistantList = useCallback(async () => {
    const assistants = await fetchAssistants()
    if (assistants.length === 0) {
      cortexCreateAssistant(janAssistant).then((assistant) => {
        assistants.push(assistant)
      })
    }
    setAssistants(assistants)
  }, [fetchAssistants, setAssistants, cortexCreateAssistant])

  const createAssistant = useCallback(
    async (assistant: Assistant) => cortexCreateAssistant(assistant),
    [cortexCreateAssistant]
  )

  return { getAssistantList, createAssistant }
}

export default useAssistants
