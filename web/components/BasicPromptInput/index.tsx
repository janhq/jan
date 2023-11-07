'use client'

import { ChangeEvent, useEffect, useRef } from 'react'

import { useAtom, useAtomValue } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { useCreateConversation } from '@/hooks/useCreateConversation'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { getActiveConvoIdAtom } from '@/helpers/atoms/Conversation.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'

const BasicPromptInput: React.FC = () => {
  const activeConversationId = useAtomValue(getActiveConvoIdAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const { sendChatMessage } = useSendChatMessage()
  const { requestCreateConvo } = useCreateConversation()

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = async (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        if (activeConversationId) {
          event.preventDefault()
          sendChatMessage()
        } else {
          if (!selectedModel) {
            console.log('No model selected')
            return
          }
          await requestCreateConvo(selectedModel)
          sendChatMessage()
        }
      }
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [currentPrompt])

  const handleMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(event.target.value)
  }

  // Auto adjust textarea height based on content
  const MAX_ROWS = 30

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto' // 1 row
      const scrollHeight = textareaRef.current.scrollHeight
      const maxScrollHeight =
        parseInt(window.getComputedStyle(textareaRef.current).lineHeight, 10) *
        MAX_ROWS
      textareaRef.current.style.height = `${Math.min(
        scrollHeight,
        maxScrollHeight
      )}px`
    }
  }

  return (
    <div className=" rounded-lg border border-border shadow-sm">
      <textarea
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        value={currentPrompt}
        onChange={handleMessageChange}
        name="comment"
        id="comment"
        className="text-background-reverse block w-full resize-none border-0 bg-transparent py-1.5 placeholder:text-gray-400 focus:ring-0 sm:text-sm sm:leading-6"
        placeholder="Message ..."
        rows={1}
        style={{ overflow: 'auto' }}
      />
      {/* Spacer element to match the height of the toolbar */}
      <div className="py-2" aria-hidden="true">
        {/* Matches height of button in toolbar (1px border + 36px content height) */}
        <div className="py-px">
          <div className="h-9" />
        </div>
      </div>
    </div>
  )
}

export default BasicPromptInput
