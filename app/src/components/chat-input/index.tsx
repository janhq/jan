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

import { useRef, useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useModels } from '@/stores/models-store'
import { useConversations } from '@/stores/conversation-store'
import { useCapabilities } from '@/stores/capabilities-store'
import { DropDrawerItem, DropDrawerSeparator } from '@/components/ui/dropdrawer'
import {
  GlobeIcon,
  Leaf,
  MegaphoneIcon,
  Settings2,
  ShapesIcon,
  X,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
  const modelDetail = useModels((state) => state.modelDetail)

  const createConversation = useConversations(
    (state) => state.createConversation
  )

  const searchEnabled = useCapabilities((state) => state.searchEnabled)
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const toggleSearch = useCapabilities((state) => state.toggleSearch)
  const toggleDeepResearch = useCapabilities(
    (state) => state.toggleDeepResearch
  )
  const setSearchEnabled = useCapabilities((state) => state.setSearchEnabled)
  const setDeepResearchEnabled = useCapabilities(
    (state) => state.setDeepResearchEnabled
  )

  console.log('modelDetail', modelDetail)

  const isSupportTools =
    modelDetail.supported_parameters?.names.includes('tools')

  const isSupportReasoning = modelDetail.supports_reasoning

  const isSupportDeepResearch = isSupportTools && isSupportReasoning

  // Auto-disable capabilities when model doesn't support them
  useEffect(() => {
    // Only run if we have a valid model loaded
    if (!modelDetail.id) return

    if (!isSupportTools && searchEnabled) {
      setSearchEnabled(false)
    }
  }, [isSupportTools, searchEnabled, setSearchEnabled, modelDetail.id])

  useEffect(() => {
    // Only run if we have a valid model loaded
    if (!modelDetail.id) return

    if (!isSupportDeepResearch && deepResearchEnabled) {
      setDeepResearchEnabled(false)
    }
  }, [
    isSupportDeepResearch,
    deepResearchEnabled,
    setDeepResearchEnabled,
    modelDetail.id,
  ])

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text)
    const hasAttachments = Boolean(message.files?.length)

    if (!(hasText || hasAttachments)) {
      return
    }

    console.log('conversationId,', conversationId)
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
                  className="rounded-full mx-1"
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropDrawerItem
                          onSelect={(e) => e.preventDefault()}
                          disabled={!isSupportTools}
                        >
                          <div className="flex gap-2 items-center justify-between w-full">
                            <div className="flex gap-2 items-center w-full">
                              <GlobeIcon />
                              <span>Search</span>
                            </div>
                            <Switch
                              checked={
                                deepResearchEnabled ? true : searchEnabled
                              }
                              onCheckedChange={toggleSearch}
                              disabled={!isSupportTools || deepResearchEnabled}
                            />
                          </div>
                        </DropDrawerItem>
                      </div>
                    </TooltipTrigger>
                    {!isSupportTools && (
                      <TooltipContent>
                        <p>This model doesn't support search</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropDrawerItem
                          onSelect={(e) => e.preventDefault()}
                          disabled={!isSupportDeepResearch}
                        >
                          <div className="flex gap-2 items-center justify-between w-full">
                            <div className="flex gap-2 items-center w-full">
                              <MegaphoneIcon />
                              <span>Deep Research</span>
                            </div>
                            <Switch
                              checked={deepResearchEnabled}
                              onCheckedChange={toggleDeepResearch}
                              disabled={!isSupportDeepResearch}
                            />
                          </div>
                        </DropDrawerItem>
                      </div>
                    </TooltipTrigger>
                    {!isSupportDeepResearch && (
                      <TooltipContent>
                        <p>This model doesn't support deep research</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
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
              {searchEnabled && !deepResearchEnabled && (
                <PromptInputButton
                  variant="outline"
                  className="rounded-full group transition-all"
                  onClick={toggleSearch}
                >
                  <GlobeIcon className="text-muted-foreground size-4 group-hover:hidden" />
                  <X className="text-muted-foreground size-4 hidden group-hover:block" />
                  <span>Search</span>
                </PromptInputButton>
              )}

              {deepResearchEnabled && (
                <PromptInputButton
                  variant="outline"
                  className="rounded-full group transition-all"
                  onClick={toggleDeepResearch}
                >
                  <MegaphoneIcon className="text-muted-foreground size-4 group-hover:hidden" />
                  <X className="text-muted-foreground size-4 hidden group-hover:block" />
                  <span>Deep Research</span>
                </PromptInputButton>
              )}
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
