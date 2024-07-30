import { useMemo } from 'react'

import { useAtomValue } from 'jotai'

import SendMessageButton from './SendMessageButton'
import StopInferenceButton from './StopInferenceButton'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

import { isGeneratingResponseAtom } from '@/helpers/atoms/Thread.atom'

const ChatActionButton: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  const showStopButton = useMemo(() => {
    if (isGeneratingResponse) return true

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return false
    if (lastMessage.status === 'in_progress') return true
    return false
  }, [isGeneratingResponse, messages])

  if (showStopButton) {
    return <StopInferenceButton />
  }

  return <SendMessageButton />
}

export default ChatActionButton
