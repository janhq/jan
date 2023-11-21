import { useEffect, useState } from 'react'

import { Model, Thread } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { useActiveModel } from './useActiveModel'
import { useGetDownloadedModels } from './useGetDownloadedModels'

import { currentConversationAtom } from '@/helpers/atoms/Conversation.atom'

export default function useGetInputState() {
  const [inputState, setInputState] = useState<InputType>('loading')
  const currentThread = useAtomValue(currentConversationAtom)
  const { activeModel } = useActiveModel()
  const { downloadedModels } = useGetDownloadedModels()

  const handleInputState = (
    thread: Thread | undefined,
    currentModel: Model | undefined
  ) => {
    if (thread == null) return
    if (currentModel == null) {
      setInputState('loading')
      return
    }

    // check if convo model id is in downloaded models
    const isModelAvailable = downloadedModels.some(
      (model) => model.id === thread.modelId
    )

    if (!isModelAvailable) {
      // can't find model in downloaded models
      setInputState('model-not-found')
      return
    }

    if (thread.modelId !== currentModel.id) {
      // in case convo model and active model is different,
      // ask user to init the required model
      setInputState('model-mismatch')
      return
    }

    setInputState('available')
  }

  useEffect(() => {
    handleInputState(currentThread, activeModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { inputState, currentThread }
}

type InputType = 'available' | 'loading' | 'model-mismatch' | 'model-not-found'
