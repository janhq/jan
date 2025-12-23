import { toast } from 'sonner'
import type { UIMessage } from '@ai-sdk/react'
import { router } from '@/main'

// Helper to extract text content from assistant messages (searches backwards)
function getLastAssistantContent(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && Array.isArray(msg.parts)) {
      // Look for any text part with non-empty content
      for (const part of msg.parts) {
        if (part.type === 'text' && 'text' in part) {
          const text = (part as { text: string }).text.trim()
          if (text) {
            return text
          }
        }
      }
      // Continue searching earlier messages if this one has no text
    }
  }
  return null
}

export function showChatCompletionToast(
  title: string,
  messages: UIMessage[],
  conversationId: string
) {
  const content = getLastAssistantContent(messages)
  const truncatedContent = content
    ? content.length > 80
      ? content.slice(0, 80) + '...'
      : content
    : undefined

  let toastId: string | number

  toastId = toast(title, {
    description: truncatedContent,
    duration: 20000,
    action: {
      label: 'View',
      onClick: () => {
        toast.dismiss(toastId)
        router.navigate({
          to: '/threads/$conversationId',
          params: { conversationId },
        })
      },
    },
    actionButtonStyle: {
      backgroundColor: 'var(--color-primary)',
      color: 'var(--color-primary-foreground)',
    },
  })

  return toastId
}
