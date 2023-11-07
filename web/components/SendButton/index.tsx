import { useAtom, useAtomValue } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import useSendChatMessage from '@/hooks/useSendChatMessage'

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
