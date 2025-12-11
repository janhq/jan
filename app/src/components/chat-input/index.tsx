import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  // PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  // PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'

// import { GlobeIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useModels } from '@/stores/models-store'
import { useConversations } from '@/stores/conversation-store'
import { completionsService } from '@/services/completions-service'

const SUBMITTING_TIMEOUT = 200
const STREAMING_TIMEOUT = 2000

const ChatInput = ({
  initialConversation = false,
  conversationId,
  submit,
}: {
  initialConversation?: boolean
  conversationId?: string | undefined
  submit?: () => void
}) => {
  const [status, setStatus] = useState<
    'submitted' | 'streaming' | 'ready' | 'error'
  >('ready')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()

  const selectedModel = useModels((state) => state.selectedModel)
  const createConversation = useConversations(
    (state) => state.createConversation
  )

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text)
    const hasAttachments = Boolean(message.files?.length)

    if (!(hasText || hasAttachments)) {
      return
    }

    console.log('selectedModel', selectedModel)
    setStatus('submitted')
    console.log('Submitting message:', message)

    // if (selectedModel) {
    if (initialConversation) {
      createConversation({
        title: message.text || 'New Chat',
        metadata: {
          model_id: selectedModel.id,
          model_provider: selectedModel.owned_by,
          is_favorite: 'false',
        },
      })
        .then((conversation) => {
          // Redirect to the conversation detail page
          // navigate({
          //   to: '/threads/$conversationId',
          //   params: { conversationId: conversation.id },
          // })

          // Call completions service after redirect
          // return completionsService.completions({
          //   model: selectedModel.id,
          //   messages: [
          //     {
          //       role: 'user',
          //       content: message.text || '',
          //     },
          //   ],
          //   conversation: conversation.id,
          //   stream: true,
          //   store_reasoning: true,
          //   store: true,
          // })
          return submit?.()
        })
        .catch((error) => {
          console.error('Failed to create initial conversation:', error)
          setStatus('error')
        })
    } else {
      // completionsService.completions({
      //   model: selectedModel.id,
      //   messages: [
      //     {
      //       role: 'user',
      //       content: message.text || '',
      //     },
      //   ],
      //   conversation: conversationId,
      //   stream: true,
      //   store_reasoning: true,
      //   store: true,
      // })
      submit?.()
    }
    // }

    setTimeout(() => {
      setStatus('streaming')
    }, SUBMITTING_TIMEOUT)

    setTimeout(() => {
      setStatus('ready')
    }, STREAMING_TIMEOUT)
  }

  return (
    <div className="w-full">
      <PromptInputProvider>
        <PromptInput globalDrop multiple onSubmit={handleSubmit}>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
          <PromptInputBody>
            <PromptInputTextarea ref={textareaRef} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger
                  className="rounded-full"
                  variant="secondary"
                />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              {/* <PromptInputSpeechButton textareaRef={textareaRef} /> */}
              {/* <PromptInputButton>
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton> */}
            </PromptInputTools>
            <PromptInputSubmit status={status} className="rounded-full " />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

export default ChatInput
