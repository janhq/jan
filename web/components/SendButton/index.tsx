import { useAtom, useAtomValue } from 'jotai'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { currentPromptAtom } from '@/helpers/JotaiWrapper'
import { currentConvoStateAtom } from '@/helpers/atoms/Conversation.atom'

const SendButton: React.FC = () => {
  const [currentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)

  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  return (
    <button onClick={sendChatMessage} disabled={disabled} type="submit">
      Send
    </button>
  )
}

export default SendButton
