import { useChat } from '@/hooks/useChat'
import { useMessages } from '@/hooks/useMessages'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Play } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

export const GenerateResponseButton = ({ threadId }: { threadId: string }) => {
  const { t } = useTranslation()
  const deleteMessage = useMessages((state) => state.deleteMessage)
 const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )
  const sendMessage = useChat()
  const generateAIResponse = () => {
    const latestUserMessage = messages[messages.length - 1]
    if (
      latestUserMessage?.content?.[0]?.text?.value &&
      latestUserMessage.role === 'user'
    ) {
      sendMessage(latestUserMessage.content[0].text.value, false)
    } else if (latestUserMessage?.metadata?.tool_calls) {
      // Only regenerate assistant message is allowed
      const threadMessages = [...messages]
      let toSendMessage = threadMessages.pop()
      while (toSendMessage && toSendMessage?.role !== 'user') {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        toSendMessage = threadMessages.pop()
      }
      if (toSendMessage) {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        sendMessage(toSendMessage.content?.[0]?.text?.value || '')
      }
    }
  }
  return (
    <div
      className="mx-2 bg-main-view-fg/10 px-2 border border-main-view-fg/5 flex items-center justify-center rounded-xl gap-x-2 cursor-pointer pointer-events-auto"
      onClick={generateAIResponse}
    >
      <p className="text-xs">{t('common:generateAiResponse')}</p>
      <Play size={12} />
    </div>
  )
}
