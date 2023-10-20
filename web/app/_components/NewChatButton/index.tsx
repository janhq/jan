'use client'

import React from 'react'
import SecondaryButton from '../SecondaryButton'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@/_helpers/atoms/MainView.atom'
import useCreateConversation from '@/_hooks/useCreateConversation'
import useInitModel from '@/_hooks/useInitModel'
import { PlusIcon } from '@heroicons/react/24/outline'
import { activeAssistantModelAtom } from '@/_helpers/atoms/Model.atom'
import { AssistantModel } from '@/_models/AssistantModel'

const NewChatButton: React.FC = () => {
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const setMainView = useSetAtom(setMainViewStateAtom)
  const { requestCreateConvo } = useCreateConversation()
  const { initModel } = useInitModel()

  const onClick = () => {
    if (!activeModel) {
      setMainView(MainViewState.ConversationEmptyModel)
    } else {
      createConversationAndInitModel(activeModel)
    }
  }

  const createConversationAndInitModel = async (model: AssistantModel) => {
    await requestCreateConvo(model)
    await initModel(model)
  }

  return (
    <SecondaryButton
      title={'New Chat'}
      onClick={onClick}
      className="mx-3 my-5"
      icon={<PlusIcon width={16} height={16} />}
    />
  )
}

export default React.memo(NewChatButton)
