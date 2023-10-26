import { currentPromptAtom } from '@helpers/JotaiWrapper'
import { currentConvoStateAtom } from '@helpers/atoms/Conversation.atom'
import useSendChatMessage from '@hooks/useSendChatMessage'
import { useAtom, useAtomValue } from 'jotai'
import { Button } from '@uikit'

const SendButton: React.FC = () => {
  const [currentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)

  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  return (
    <Button
      themes="accent"
      onClick={sendChatMessage}
      disabled={disabled}
      type="submit"
    >
      Send
    </Button>
  )
}

export default SendButton
