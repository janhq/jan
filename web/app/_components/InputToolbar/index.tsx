/* eslint-disable react-hooks/rules-of-hooks */
'use client'

import BasicPromptInput from '../BasicPromptInput'
import BasicPromptAccessories from '../BasicPromptAccessories'
import { useAtomValue, useSetAtom } from 'jotai'
import SecondaryButton from '../SecondaryButton'
import { PlusIcon } from '@heroicons/react/24/outline'
import useCreateConversation from '@hooks/useCreateConversation'
import { activeAssistantModelAtom, stateModel } from '@helpers/atoms/Model.atom'
import {
  currentConvoStateAtom,
  getActiveConvoIdAtom,
} from '@helpers/atoms/Conversation.atom'
import useGetInputState from '@hooks/useGetInputState'
import useStartStopModel from '@hooks/useStartStopModel'
import { userConversationsAtom } from '@helpers/atoms/Conversation.atom'
import { showingModalNoActiveModel } from '@helpers/atoms/Modal.atom'

const InputToolbar: React.FC = () => {
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)
  const { inputState, currentConvo } = useGetInputState()
  const { requestCreateConvo } = useCreateConversation()
  const { startModel } = useStartStopModel()
  const { loading } = useAtomValue(stateModel)
  const conversations = useAtomValue(userConversationsAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const setShowModalNoActiveModel = useSetAtom(showingModalNoActiveModel)

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel)
    } else {
      setShowModalNoActiveModel(true)
    }
  }

  const onStartModelClick = () => {
    const modelId = currentConvo?.modelId
    if (!modelId) return
    startModel(modelId)
  }

  if (!activeConvoId) {
    return null
  }
  if (
    (activeConvoId && inputState === 'model-mismatch') ||
    inputState === 'loading'
  ) {
    // const message = inputState === 'loading' ? 'Loading..' : 'Model mismatch!'
    return (
      <div className="sticky bottom-0 flex items-center justify-center bg-background/90">
        <div className="my-2">
          {/* <p className="mx-auto my-5 line-clamp-2 text-ellipsis text-center italic text-gray-600">
            {message}
          </p> */}
          <SecondaryButton
            onClick={onStartModelClick}
            title={`Start model ${currentConvo?.modelId}`}
          />
        </div>
      </div>
    )
  }

  if (inputState === 'model-not-found') {
    return (
      <div className="sticky bottom-0 flex items-center justify-center bg-background/90">
        <p className="mx-auto my-5 line-clamp-2 text-ellipsis text-center italic text-gray-600">
          Model {currentConvo?.modelId} not found! Please re-download the model
          first.
        </p>
      </div>
    )
  }

  if (conversations.length > 0)
    return (
      <div className="sticky bottom-0 w-full bg-background/90 px-5 py-0">
        {currentConvoState?.error && (
          <div className="flex flex-row justify-center">
            <span className="mx-5 my-2 text-sm text-red-500">
              {currentConvoState?.error?.toString()}
            </span>
          </div>
        )}
        <div className="my-3 flex justify-center gap-2">
          <SecondaryButton
            onClick={onNewConversationClick}
            title="New Conversation"
            icon={<PlusIcon width={16} height={16} />}
          />
        </div>
        {/* My text input */}
        <div className="mb-5 flex items-start space-x-4">
          <div className="relative min-w-0 flex-1">
            <BasicPromptInput />
            <BasicPromptAccessories />
          </div>
        </div>
      </div>
    )
}

export default InputToolbar
