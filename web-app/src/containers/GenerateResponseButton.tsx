import { useChat } from '@/hooks/useChat'
import { useMessages } from '@/hooks/useMessages'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Play } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useMemo } from 'react'
import { MessageStatus } from '@janhq/core'

export const GenerateResponseButton = ({ threadId }: { threadId: string }) => {
  const { t } = useTranslation()
  const deleteMessage = useMessages((state) => state.deleteMessage)
 const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )
  const sendMessage = useChat()

  // Detect if last message is a partial assistant response (user stopped midway)
  // Only true if message has Stopped status (interrupted by user)
  const isPartialResponse = useMemo(() => {
    if (!messages || messages.length < 2) return false
    const lastMessage = messages[messages.length - 1]
    const secondLastMessage = messages[messages.length - 2]

    // Partial if: last is assistant with Stopped status, second-last is user, no tool calls
    return (
      lastMessage?.role === 'assistant' &&
      lastMessage?.status === MessageStatus.Stopped &&
      secondLastMessage?.role === 'user' &&
      !lastMessage?.metadata?.tool_calls
    )
  }, [messages])

  const generateAIResponse = () => {
    // If continuing a partial response, keep the message and continue from it
    if (isPartialResponse) {
      const partialMessage = messages[messages.length - 1]
      const userMessage = messages[messages.length - 2]
      if (userMessage?.content?.[0]?.text?.value) {
        // Pass the partial message ID to continue from it
        sendMessage(
          userMessage.content[0].text.value,
          false,
          undefined,
          partialMessage.id
        )
      }
      return
    }

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
      <p className="text-xs">
        {isPartialResponse
          ? t('common:continueAiResponse')
          : t('common:generateAiResponse')}
      </p>
      <Play size={12} />
    </div>
  )
}
