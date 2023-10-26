import { currentConversationAtom } from '@helpers/atoms/Conversation.atom'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useGetDownloadedModels } from './useGetDownloadedModels'

export default function useGetInputState() {
  const [inputState, setInputState] = useState<InputType>('loading')
  const currentConvo = useAtomValue(currentConversationAtom)
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { downloadedModels } = useGetDownloadedModels()

  const handleInputState = (
    convo: Conversation | undefined,
    currentModel: AssistantModel | undefined,
    models: AssistantModel[]
  ) => {
    if (convo == null) return
    if (currentModel == null) {
      setInputState('loading')
      return
    }

    // check if convo model id is in downloaded models
    const isModelAvailable = downloadedModels.some(
      (model) => model._id === convo.modelId
    )

    if (!isModelAvailable) {
      // can't find model in downloaded models
      setInputState('model-not-found')
      return
    }

    if (convo.modelId !== currentModel._id) {
      // in case convo model and active model is different,
      // ask user to init the required model
      setInputState('model-mismatch')
      return
    }

    setInputState('available')
  }

  useEffect(() => {
    handleInputState(currentConvo, activeModel, downloadedModels)
  }, [currentConvo, activeModel, downloadedModels])

  return { inputState, currentConvo }
}

type InputType = 'available' | 'loading' | 'model-mismatch' | 'model-not-found'
