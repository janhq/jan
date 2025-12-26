import { toast } from 'sonner'
import type { UIMessage } from '@ai-sdk/react'
import { useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { CONTENT_TYPE, MESSAGE_ROLE } from '@/constants'

// Helper to extract text content from assistant messages (searches backwards)
function getLastAssistantContent(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === MESSAGE_ROLE.ASSISTANT && Array.isArray(msg.parts)) {
      // Look for any text part with non-empty content
      for (const part of msg.parts) {
        if (part.type === CONTENT_TYPE.TEXT && 'text' in part) {
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

interface ChatCompletionToastContentProps {
  title: string
  content?: string
  conversationId: string
  toastId: string | number
}

function ChatCompletionToastContent({
  title,
  content,
  conversationId,
  toastId,
}: ChatCompletionToastContentProps) {
  const navigate = useNavigate()

  return (
    <div
      className="flex items-start gap-3 w-[400px] bg-popover text-popover-foreground border rounded-lg p-4 shadow-lg cursor-pointer"
      onClick={() => {
        toast.dismiss(toastId)
        navigate({ to: '/threads/$conversationId', params: { conversationId } })
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{title}</p>
        {content && (
          <p className="text-muted-foreground text-sm mt-1 truncate">
            {content}
          </p>
        )}
      </div>
      <button
        className="text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          toast.dismiss(toastId)
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function showChatCompletionToast(
  title: string,
  messages: UIMessage[],
  conversationId: string
) {
  const content = getLastAssistantContent(messages) ?? undefined

  const toastId = toast.custom(
    (t) => (
      <ChatCompletionToastContent
        toastId={t}
        title={title}
        content={content}
        conversationId={conversationId}
      />
    ),
    { duration: 5000 }
  )

  return toastId
}
