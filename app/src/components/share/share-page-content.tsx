import { useEffect, useState } from 'react'
import { shareService } from '@/services/share-service'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { AlertCircleIcon, LockIcon } from 'lucide-react'
import { MessageItem } from '@/components/threads/message-item'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'
import ChatInput from '@/components/chat-input'
import type { UIMessage } from 'ai'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { convertToUIMessages } from '@/lib/utils'
import { useModels } from '@/stores/models-store'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { conversationService } from '@/services/conversation-service'
import { useConversations } from '@/stores/conversation-store'

interface SharePageContentProps {
  slug: string
}

// Scroll animation config (same as thread-page-content)
const SCROLL_MASS = 1.35
const SCROLL_DAMPING = 0.72
const SCROLL_STIFFNESS = 0.045

export function SharePageContent({ slug }: SharePageContentProps) {
  const [shareData, setShareData] = useState<PublicShareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isForking, setIsForking] = useState(false)

  const createConversation = useConversations(
    (state) => state.createConversation
  )

  const selectedModel = useModels((state) => state.selectedModel)
  const navigate = useNavigate()

  const handleSubmit = async (message?: PromptInputMessage) => {
    if (!shareData || !selectedModel || !message) return

    setIsForking(true)
    try {
      // Fork the shared conversation to create a new conversation
      const conversation = await createConversation({
        title: shareData.title || 'Forked Conversation',
        items: shareData.snapshot.items.map((item) => ({
          content: item.content,
          role: item.role,
          type: item.type,
        })),
        metadata: {
          model_id: selectedModel.id,
          model_provider: selectedModel.owned_by,
          is_favorite: 'false',
        },
      })

      // Store the initial message in sessionStorage for the new conversation
      sessionStorage.setItem(
        `initial-message-${conversation.id}`,
        JSON.stringify(message)
      )
      // Store the cached messages for preview
      sessionStorage.setItem(
        `initial-items-${conversation.id}`,
        JSON.stringify(shareData.snapshot.items)
      )

      // Redirect to the conversation detail page
      navigate({
        to: '/threads/$conversationId',
        params: { conversationId: conversation.id },
      })
    } catch (error) {
      console.error('Failed to fork conversation:', error)
      toast.error('Failed to continue conversation. Please try again.')
      setIsForking(false)
    }
  }

  useEffect(() => {
    const fetchShare = async () => {
      setError(null)

      try {
        const data = await shareService.getPublicShare(slug)
        setShareData(data)

        // Convert snapshot items to UIMessage format
        const uiMessages = convertToUIMessages(data.snapshot.items)
        setMessages(uiMessages)
      } catch (err) {
        console.error('Failed to fetch share:', err)
        if (err instanceof Error) {
          if (err.message.includes('revoked')) {
            setError('This share has been revoked and is no longer accessible.')
          } else {
            setError(
              'Failed to load shared conversation. Please check the link and try again.'
            )
          }
        } else {
          setError('An unexpected error occurred.')
        }
      }
    }

    fetchShare()
  }, [slug])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader
          conversationTitle={shareData?.title || 'Shared Conversation'}
        />
        {error || !shareData ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4 max-w-md text-center px-4">
              <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                {error?.includes('revoked') ? (
                  <LockIcon className="size-8 text-muted-foreground" />
                ) : (
                  <AlertCircleIcon className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">
                  {error?.includes('revoked')
                    ? 'Share Revoked'
                    : 'Unable to Load Share'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {error || 'This shared conversation could not be found.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col h-full overflow-hidden max-h-[calc(100vh-56px)] w-full">
            {/* Messages Area */}
            <div className="flex-1 relative">
              <Conversation
                className="absolute inset-0 text-start"
                mass={SCROLL_MASS}
                damping={SCROLL_DAMPING}
                stiffness={SCROLL_STIFFNESS}
              >
                <ConversationContent className="max-w-3xl mx-auto">
                  <div className="pt-8 pb-6 w-full flex justify-center px-4">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/50 backdrop-blur-sm max-w-2xl">
                      <div className="size-1.5 rounded-full bg-primary/60 animate-pulse shrink-0" />
                      <p className="text-sm font-medium text-muted-foreground min-w-0 flex items-center gap-1">
                        <span className="shrink-0">
                          Viewing shared conversation:
                        </span>{' '}
                        <span
                          className="text-foreground truncate"
                          title={shareData.title || 'Untitled'}
                        >
                          {shareData.title || 'Untitled'}
                        </span>
                      </p>
                    </div>
                  </div>

                  {messages.map((message, messageIndex) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      isFirstMessage={messageIndex === 0}
                      isLastMessage={messageIndex === messages.length - 1}
                      status="ready"
                      // No regenerate for shared conversations
                      onRegenerate={undefined}
                    />
                  ))}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            </div>

            {/* Chat Input - Fixed at bottom */}
            <div className="px-4 py-4 max-w-3xl mx-auto w-full">
              <ChatInput
                submit={handleSubmit}
                status={isForking ? 'submitted' : 'ready'}
              />
            </div>
          </div>
        )}
      </SidebarInset>
    </>
  )
}
