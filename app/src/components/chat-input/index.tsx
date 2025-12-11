import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'

// import { GlobeIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useModels } from '@/stores/models-store'
import { useConversations } from '@/stores/conversation-store'
// import { completionsService } from '@/services/completions-service'
import { DropDrawerItem, DropDrawerSeparator } from '@/components/ui/dropdrawer'
import {
  GlobeIcon,
  Leaf,
  MegaphoneIcon,
  Settings2,
  ShapesIcon,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'

const SUBMITTING_TIMEOUT = 200
const STREAMING_TIMEOUT = 2000

const ChatInput = ({
  initialConversation = false,
  conversationId,
  submit,
}: {
  initialConversation?: boolean
  conversationId?: string | undefined
  submit?: (message: PromptInputMessage) => void
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

    if (selectedModel) {
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
            // Store the initial message in sessionStorage for the new conversation
            sessionStorage.setItem(
              `initial-message-${conversation.id}`,
              JSON.stringify(message)
            )

            // Redirect to the conversation detail page
            navigate({
              to: '/threads/$conversationId',
              params: { conversationId: conversation.id },
            })
            return
          })
          .catch((error) => {
            console.error('Failed to create initial conversation:', error)
            setStatus('error')
          })
      } else {
        submit?.(message)
      }
    }

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
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger
                  className="rounded-full ml-1"
                  variant="secondary"
                  children={
                    <Settings2 className="size-4 text-muted-foreground" />
                  }
                />
                <PromptInputActionMenuContent>
                  <DropDrawerItem>
                    <div className="flex gap-2 items-center justify-between w-full">
                      <div className="flex gap-2 items-center w-full">
                        <Leaf />
                        <span>Tone</span>
                      </div>
                    </div>
                  </DropDrawerItem>
                  <DropDrawerItem onSelect={(e) => e.preventDefault()}>
                    <div className="flex gap-2 items-center justify-between w-full">
                      <div className="flex gap-2 items-center w-full">
                        <GlobeIcon />
                        <span>Search</span>
                      </div>
                      <Switch />
                    </div>
                  </DropDrawerItem>
                  <DropDrawerItem onSelect={(e) => e.preventDefault()}>
                    <div className="flex gap-2 items-center justify-between w-full">
                      <div className="flex gap-2 items-center w-full">
                        <MegaphoneIcon />
                        <span>Deep Research</span>
                      </div>
                      <Switch />
                    </div>
                  </DropDrawerItem>
                  <DropDrawerSeparator />
                  <DropDrawerItem>
                    <div className="flex gap-2 items-center justify-between w-full">
                      <div className="flex gap-2 items-center w-full">
                        <ShapesIcon />
                        <span>Connectors</span>
                      </div>
                    </div>
                  </DropDrawerItem>
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputButton>
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton>
            </PromptInputTools>
            <div className="flex items-center gap-2">
              <PromptInputSpeechButton textareaRef={textareaRef} />
              <PromptInputSubmit status={status} className="rounded-full " />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

export default ChatInput
