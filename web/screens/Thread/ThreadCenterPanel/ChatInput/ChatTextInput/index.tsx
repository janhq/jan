import { useCallback, useEffect, useMemo, useRef } from 'react'

import { TextArea } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import useSendMessage from '@/hooks/useSendMessage'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

import { spellCheckAtom } from '@/helpers/atoms/Setting.atom'
import {
  getActiveThreadIdAtom,
  isGeneratingResponseAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  isSettingActive: boolean
}

const ChatTextInput: React.FC<Props> = ({ isSettingActive }) => {
  const { sendMessage } = useSendMessage()
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const spellCheck = useAtomValue(spellCheckAtom)

  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  const disabled = useMemo(() => {
    return !activeThreadId
  }, [activeThreadId])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCurrentPrompt(e.target.value)
    },
    [setCurrentPrompt]
  )

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeThreadId])

  useEffect(() => {
    if (textareaRef.current?.clientHeight) {
      textareaRef.current.style.height = isSettingActive ? '100px' : '40px'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
      textareaRef.current.style.overflow =
        textareaRef.current.clientHeight >= 390 ? 'auto' : 'hidden'
    }
  }, [textareaRef.current?.clientHeight, currentPrompt, isSettingActive])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        if (isGeneratingResponse) return
        const lastMessage = messages[messages.length - 1]
        if (!lastMessage || lastMessage.status !== 'in_progress') {
          sendMessage(currentPrompt)
          return
        }
      }
    },
    [messages, isGeneratingResponse, currentPrompt, sendMessage]
  )

  return (
    <TextArea
      className={twMerge(
        'relative max-h-[400px] resize-none  pr-20',
        isSettingActive && 'pb-14 pr-16'
      )}
      spellCheck={spellCheck}
      data-testid="txt-input-chat"
      style={{ height: isSettingActive ? '100px' : '40px' }}
      ref={textareaRef}
      onKeyDown={onKeyDown}
      placeholder="Ask me anything"
      disabled={disabled}
      value={currentPrompt}
      onChange={onChange}
    />
  )
}

export default ChatTextInput
