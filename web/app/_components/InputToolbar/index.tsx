/* eslint-disable react-hooks/rules-of-hooks */
'use client'

import BasicPromptInput from '../BasicPromptInput'
import BasicPromptAccessories from '../BasicPromptAccessories'
import { useAtomValue, useSetAtom } from 'jotai'
import SecondaryButton from '../SecondaryButton'
import { useEffect, useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import useCreateConversation from '@hooks/useCreateConversation'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'
import {
  currentConversationAtom,
  currentConvoStateAtom,
} from '@helpers/atoms/Conversation.atom'
import useGetBots from '@hooks/useGetBots'
import { activeBotAtom } from '@helpers/atoms/Bot.atom'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'

const InputToolbar: React.FC = () => {
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { requestCreateConvo } = useCreateConversation()
  const currentConvoState = useAtomValue(currentConvoStateAtom)
  const currentConvo = useAtomValue(currentConversationAtom)

  const setActiveBot = useSetAtom(activeBotAtom)
  const { getBotById } = useGetBots()
  const [inputState, setInputState] = useState<
    'available' | 'disabled' | 'loading'
  >()
  const [error, setError] = useState<string | undefined>()
  const { downloadedModels } = useGetDownloadedModels()

  useEffect(() => {
    const getReplyState = async () => {
      setInputState('loading')
      if (currentConvo && currentConvo.botId && currentConvo.botId.length > 0) {
        // if botId is set, check if bot is available
        const bot = await getBotById(currentConvo.botId)
        console.debug('Found bot', JSON.stringify(bot, null, 2))
        if (bot) {
          setActiveBot(bot)
        }
        setInputState(bot ? 'available' : 'disabled')
        setError(
          bot
            ? undefined
            : `Bot ${currentConvo.botId} has been deleted by its creator. Your chat history is saved but you won't be able to send new messages.`
        )
      } else {
        const model = downloadedModels.find(
          (model) => model._id === activeModel?._id
        )

        setInputState(model ? 'available' : 'disabled')
        setError(
          model
            ? undefined
            : `Model ${activeModel?._id} cannot be found. Your chat history is saved but you won't be able to send new messages.`
        )
      }
    }
    getReplyState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConvo])

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel)
    }
  }

  if (inputState === 'loading') return <div>Loading..</div>

  if (inputState === 'disabled')
    return (
      <div className="sticky bottom-0 flex items-center justify-center bg-background/90">
        <p className="mx-auto my-5 line-clamp-2 text-ellipsis text-center italic text-gray-600">
          {error}
        </p>
      </div>
    )

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
