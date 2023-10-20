'use client'

import BasicPromptInput from '../BasicPromptInput'
import BasicPromptAccessories from '../BasicPromptAccessories'
import { useAtomValue } from 'jotai'
import { showingAdvancedPromptAtom } from '@/_helpers/atoms/Modal.atom'
import SecondaryButton from '../SecondaryButton'
import { Fragment } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import useCreateConversation from '@/_hooks/useCreateConversation'
import { activeAssistantModelAtom } from '@/_helpers/atoms/Model.atom'
import { currentConvoStateAtom } from '@/_helpers/atoms/Conversation.atom'

const InputToolbar: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom)
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { requestCreateConvo } = useCreateConversation()
  const currentConvoState = useAtomValue(currentConvoStateAtom)

  if (showingAdvancedPrompt) {
    return <div />
  }

  // TODO: implement regenerate
  // const onRegenerateClick = () => {};

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel)
    }
  }

  return (
    <Fragment>
      {currentConvoState?.error && (
        <div className="flex flex-row justify-center">
          <span className="mx-5 my-2 text-sm text-red-500">
            {currentConvoState?.error?.toString()}
          </span>
        </div>
      )}
      <div className="my-3 flex justify-center gap-2">
        {/* <SecondaryButton title="Regenerate" onClick={onRegenerateClick} /> */}
        <SecondaryButton
          onClick={onNewConversationClick}
          title="New Conversation"
          icon={<PlusIcon width={16} height={16} />}
        />
      </div>
      {/* My text input */}
      <div className="mx-12 mb-5 flex items-start space-x-4 md:mx-32 2xl:mx-64">
        <div className="relative min-w-0 flex-1">
          <BasicPromptInput />
          <BasicPromptAccessories />
        </div>
      </div>
    </Fragment>
  )
}

export default InputToolbar
