import { useMemo } from 'react'

import { useAtomValue } from 'jotai'

import SendMessageButton from './SendMessageButton'
import StopInferenceButton from './StopInferenceButton'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

import { isGeneratingResponseAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  onStopInferenceClick: () => void
  onSendMessageClick: (message: string) => void
}

const ChatActionButton: React.FC<Props> = ({
  onStopInferenceClick,
  onSendMessageClick,
}) => {
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
    return <StopInferenceButton onStopInferenceClick={onStopInferenceClick} />
  }

  return <SendMessageButton onSendMessageClick={onSendMessageClick} />
}

export default ChatActionButton
