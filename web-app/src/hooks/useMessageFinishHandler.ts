import { useCallback } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import {
  ChatCompletionRole,
  MessageStatus,
  type ThreadMessage,
} from '@janhq/core'
import { useMessages } from '@/hooks/useMessages'
import { extractContentPartsFromUIMessage } from '@/lib/messages'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { useModelProvider } from '@/hooks/useModelProvider'

export function useMessageFinishHandler({
  threadId,
  addMessage,
  updateMessage,
  setPendingContinueMessage,
  setContinueFromContent,
  setContextLimitError,
  handleContextSizeIncrease,
  executeQueuedToolCalls,
  summarizeTitle,
}: {
  threadId: string
  addMessage: (message: ThreadMessage) => void
  updateMessage: (message: ThreadMessage) => void
  setPendingContinueMessage: (message: UIMessage | null) => void
  setContinueFromContent: (content: string) => void
  setContextLimitError: (error: Error | null) => void
  handleContextSizeIncrease: () => void
  executeQueuedToolCalls: () => void
  summarizeTitle: () => void
}) {
  return useCallback(
    ({ message, isAbort }: { message: UIMessage; isAbort: boolean }) => {
      const msgMeta = message.metadata as Record<string, unknown> | undefined
      const finishReason = msgMeta?.finishReason as string | undefined

      if (!isAbort && finishReason === 'length') {
        const selectedModelState = useModelProvider.getState().selectedModel
        const usage = msgMeta?.usage as
          | { inputTokens?: number; outputTokens?: number }
          | undefined
        const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        const ctxLen =
          (selectedModelState?.settings?.ctx_len?.controller_props
            ?.value as number) ?? 32768
        if (totalTokens >= ctxLen * 0.9) {
          const autoIncrease =
            selectedModelState?.settings?.auto_increase_ctx_len?.controller_props
              ?.value ?? true
          if (autoIncrease) {
            const partialText = message.parts
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('')
            if (partialText) {
              setContinueFromContent(partialText)
              setPendingContinueMessage(message)
            }
            handleContextSizeIncrease()
          } else {
            setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
          }
        }
        return
      }

      if (!isAbort && message.parts.length) setPendingContinueMessage(null)

      if (!isAbort && message.role === 'assistant') {
        const contentParts = extractContentPartsFromUIMessage(message)
        if (contentParts.length > 0) {
          const assistantMessage: ThreadMessage = {
            type: 'text',
            role: ChatCompletionRole.Assistant,
            content: contentParts,
            id: message.id,
            object: 'thread.message',
            thread_id: threadId,
            status: MessageStatus.Ready,
            created_at: Date.now(),
            completed_at: Date.now(),
            metadata: (message.metadata || {}) as Record<string, unknown>,
          }
          const existingMessages = useMessages.getState().getMessages(threadId)
          const existing = existingMessages.find((m) => m.id === message.id)
          if (existing) updateMessage(assistantMessage)
          else addMessage(assistantMessage)
        }
      }

      executeQueuedToolCalls()
      if (!isAbort) summarizeTitle()
    },
    [
      addMessage,
      executeQueuedToolCalls,
      handleContextSizeIncrease,
      setContextLimitError,
      setContinueFromContent,
      setPendingContinueMessage,
      summarizeTitle,
      threadId,
      updateMessage,
    ]
  )
}
