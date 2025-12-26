/* eslint-disable react-hooks/exhaustive-deps */
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
  // PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input'

import React, { memo, useRef, useEffect, useState, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useModels } from '@/stores/models-store'
import { useConversations } from '@/stores/conversation-store'
import { useCapabilities } from '@/stores/capabilities-store'
import { useProjects } from '@/stores/projects-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { useIsMobileDevice } from '@/hooks/use-is-mobile-device'
import { toast } from '@/components/ui/sonner'
import {
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  LightbulbIcon,
  MegaphoneIcon,
  Settings2,
  X,
} from 'lucide-react'
import { isChromeBrowser } from '@janhq/mcp-web-client'

import { BorderAnimate } from '../ui/border-animate'
import { cn } from '@/lib/utils'
import type { ChatStatus } from 'ai'
import { SettingChatInput } from './setting-chat-input'
import { ProjectsChatInput } from './projects-chat-input'
import { Button } from '@/components/ui/button'
import { usePrivateChat } from '@/stores/private-chat-store'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useBrowserConnection } from '@/stores/browser-connection-store'
import { useProfile } from '@/stores/profile-store'
import { CHAT_STATUS, CONNECTION_STATE, SESSION_STORAGE_KEY, SESSION_STORAGE_PREFIX } from '@/constants'

/**
 * Generates a meaningful title from message text.
 * Returns 'New Conversation' if the text contains only special characters, URLs, or is empty.
 */
function generateThreadTitle(text: string): string {
  const trimmed = text.trim()

  // Check if the text is only a URL (or multiple URLs)
  // This regex matches common URL patterns
  const urlPattern =
    /^(https?:\/\/|www\.)[^\s]+$|^([^\s]+\.(com|org|net|io|co|edu|gov|app|dev|ai|me|info|biz|tv|cc|xyz|tech|online|site|store|blog|cloud|pro|link|page|space|live|world|zone|digital|agency|email|network|social|media|video|music|news|shop|design|studio|work|team|group|chat|help|support|docs|api|cdn|assets|static|img|images|files|data|db|admin|dashboard|portal|app|mobile|web|server|service|system|platform|solution|software|tool|tools|product|project|projects|code|dev|test|stage|prod|demo|beta|alpha|v1|v2|v3)[^\s]*)$/i

  const isOnlyUrl = urlPattern.test(trimmed)

  // Check if the text contains any word characters (letters or numbers, including Unicode)
  const hasWordCharacters = /[\p{L}\p{N}]/u.test(trimmed)

  if (!hasWordCharacters || isOnlyUrl) {
    return 'New Conversation'
  }

  // Truncate long titles to keep them manageable
  const maxLength = 100
  if (trimmed.length > maxLength) {
    return trimmed.substring(0, maxLength).trim() + '...'
  }

  return trimmed
}

// Component to handle resetting input when conversation changes
// IMPORTANT: This must be defined outside ChatInput to prevent remounting on every render
const InputResetHandler = ({
  textareaRef,
  isMobile,
  conversationId,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  isMobile: boolean
  conversationId?: string
}) => {
  const controller = usePromptInputController()

  useEffect(() => {
    // Reset input and attachments when conversationId changes
    controller.textInput.clear()
    controller.attachments.clear()

    // Restore focus after clearing (desktop only)
    if (textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }, [conversationId])

  return null
}

const ChatInput = ({
  initialConversation = false,
  status,
  projectId,
  conversationId,
  submit,
}: {
  initialConversation?: boolean
  projectId?: string
  conversationId?: string
  status?: ChatStatus
  submit?: (message?: PromptInputMessage) => void
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)

  const browserConnectionState = useBrowserConnection(
    (state) => state.connectionState
  )
  const isMobile = useIsMobile()
  const isMobileDevice = useIsMobileDevice()
  const isChromiumBrowser = useMemo(() => isChromeBrowser(), [])

  // Auto-focus on chat input when component mounts (desktop only)
  useEffect(() => {
    if (textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }, [isMobile])

  // Auto-focus when assistant finishes responding (desktop only)
  useEffect(() => {
    // Focus when status changes from 'streaming' to idle (assistant finished)
    if (status !== CHAT_STATUS.STREAMING && textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }, [status, isMobile])

  const selectedModel = useModels((state) => state.selectedModel)
  const modelDetail = useModels((state) => state.modelDetail)

  const createConversation = useConversations(
    (state) => state.createConversation
  )

  const { projects } = useProjects()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  )

  const searchEnabled = useCapabilities((state) => state.searchEnabled)
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const browserEnabled = useCapabilities((state) => state.browserEnabled)
  const reasoningEnabled = useCapabilities((state) => state.reasoningEnabled)
  const imageGenerationEnabled = useCapabilities(
    (state) => state.imageGenerationEnabled
  )
  const toggleSearch = useCapabilities((state) => state.toggleSearch)
  const toggleDeepResearch = useCapabilities(
    (state) => state.toggleDeepResearch
  )
  const toggleBrowser = useCapabilities((state) => state.toggleBrowser)
  const toggleInstruct = useCapabilities((state) => state.toggleReasoning)
  const toggleImageGeneration = useCapabilities(
    (state) => state.toggleImageGeneration
  )
  const hydrateCapabilities = useCapabilities((state) => state.hydrate)

  const setSearchEnabled = useCapabilities((state) => state.setSearchEnabled)
  const setDeepResearchEnabled = useCapabilities(
    (state) => state.setDeepResearchEnabled
  )
  const setBrowserEnabled = useCapabilities((state) => state.setBrowserEnabled)
  const setReasoningEnabled = useCapabilities(
    (state) => state.setReasoningEnabled
  )
  const setImageGenerationEnabled = useCapabilities(
    (state) => state.setImageGenerationEnabled
  )

  const fetchPreferences = useProfile((state) => state.fetchPreferences)
  const fetchSettings = useProfile((state) => state.fetchSettings)
  const pref = useProfile((state) => state.preferences)
  const settings = useProfile((state) => state.settings)

  const isSupportTools = modelDetail.supports_tools
  const isSupportReasoning = modelDetail.supports_reasoning
  const isSupportDeepResearch = isSupportTools && isSupportReasoning
  const isSupportInstruct = modelDetail.supports_instruct
  const isBrowserSupported = isChromiumBrowser && modelDetail.supports_browser
  const shouldShowBrowserUI = isBrowserSupported && !isMobileDevice
  const isSupportImageGeneration =
    settings?.server_capabilities?.image_generation_enabled ?? false

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

  // Auto-disable browser capability when disconnected
  useEffect(() => {
    if (browserConnectionState === CONNECTION_STATE.DISCONNECTED && browserEnabled) {
      setBrowserEnabled(false)
    }
  }, [browserConnectionState, browserEnabled, setBrowserEnabled])

  // Disable browser capability on unsupported environments
  useEffect(() => {
    if (!shouldShowBrowserUI && browserEnabled) {
      setBrowserEnabled(false)
    }
  }, [shouldShowBrowserUI, browserEnabled, setBrowserEnabled])

  useEffect(() => {
    fetchPreferences()
    fetchSettings()
  }, [])

  useEffect(() => {
    if (pref) {
      hydrateCapabilities(pref.preferences)
    }
  }, [pref, hydrateCapabilities])

  // Auto-disable image generation when server doesn't support it
  useEffect(() => {
    if (!isSupportImageGeneration && imageGenerationEnabled) {
      setImageGenerationEnabled(false)
    }
  }, [isSupportImageGeneration, imageGenerationEnabled, setImageGenerationEnabled])

  const handleError = (err: {
    code: 'max_files' | 'max_file_size' | 'accept' | 'max_images'
    message: string
  }) => {
    toast.error(err.message)
  }

  const handleSubmit = (message: PromptInputMessage) => {
    const trimmedText = message.text.trim()
    const hasText = Boolean(trimmedText)
    const hasAttachments = Boolean(message.files?.length)

    if (!(hasText || hasAttachments)) {
      submit?.()
      return
    }

    const normalizedMessage: PromptInputMessage = {
      ...message,
      text: trimmedText,
    }

    if (!selectedModel) {
      toast.warning('Please select a model to start chatting.')
      return
    }

    if (initialConversation) {
      if (isPrivateChat) {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
          JSON.stringify(normalizedMessage)
        )
        navigate({
          to: '/threads/temporary',
        })

        return
      }

      const conversationPayload: CreateConversationPayload = {
        title: generateThreadTitle(normalizedMessage.text),
        ...(projectId && { project_id: String(projectId) }),
        ...(selectedProjectId && { project_id: selectedProjectId }),
        metadata: {
          model_id: selectedModel.id,
          model_provider: selectedModel.owned_by,
          is_favorite: 'false',
        },
      }

      createConversation(conversationPayload)
        .then((conversation) => {
          // Store the initial message in sessionStorage for the new conversation
          sessionStorage.setItem(
            `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${conversation.id}`,
            JSON.stringify(normalizedMessage)
          )

          // Clear selected project after creating conversation
          setSelectedProjectId(null)

          // Redirect to the conversation detail page
          navigate({
            to: '/threads/$conversationId',
            params: { conversationId: conversation.id },
          })

          return
        })
        .catch((error) => {
          console.error('Failed to create initial conversation:', error)
        })
    } else {
      submit?.(normalizedMessage)
    }
  }

  return (
    <div>
      <div
        className={cn(
          'w-full relative rounded-3xl p-[1.5px]',
          !initialConversation &&
            (status === CHAT_STATUS.STREAMING || status === CHAT_STATUS.SUBMITTED) &&
            'overflow-hidden outline-0'
        )}
      >
        <PromptInputProvider
          maxImages={10}
          maxFileSize={10 * 1024 * 1024} //10MB
          accept="image/jpeg,image/jpg,image/png"
          onError={handleError}
        >
          <InputResetHandler
            textareaRef={textareaRef}
            isMobile={isMobile}
            conversationId={conversationId}
          />
          <PromptInput
            accept="image/jpeg,image/jpg,image/png"
            globalDrop
            multiple
            userId={conversationId || projectId || 'anonymous'}
            onError={handleError}
            onSubmit={handleSubmit}
            className="rounded-3xl relative z-40 bg-background"
          >
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                disabled={status === CHAT_STATUS.STREAMING || status === CHAT_STATUS.SUBMITTED}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger
                    className="rounded-full"
                    variant="secondary"
                  />
                  <PromptInputActionMenuContent className="lg:w-56">
                    <PromptInputActionAddAttachments label="Add photos" />
                    {initialConversation && !projectId && !isPrivateChat && (
                      <ProjectsChatInput
                        currentProjectId={selectedProjectId || undefined}
                        onProjectSelect={(projectId) => {
                          setSelectedProjectId(projectId)
                        }}
                      />
                    )}
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <SettingChatInput
                  searchEnabled={searchEnabled}
                  deepResearchEnabled={deepResearchEnabled}
                  browserEnabled={browserEnabled}
                  reasoningEnabled={reasoningEnabled}
                  imageGenerationEnabled={imageGenerationEnabled}
                  disablePreferences={status === CHAT_STATUS.STREAMING}
                  toggleSearch={() => {
                    toggleSearch()
                    setBrowserEnabled(false)
                    setImageGenerationEnabled(false)
                  }}
                  toggleDeepResearch={() => {
                    toggleDeepResearch()
                    setBrowserEnabled(false)
                    setImageGenerationEnabled(false)
                  }}
                  toggleBrowser={() => {
                    toggleBrowser()
                    setDeepResearchEnabled(false)
                    setSearchEnabled(false)
                    setImageGenerationEnabled(false)
                  }}
                  toggleImageGeneration={() => {
                    toggleImageGeneration()
                    // Disable all other capabilities when image generation is enabled
                    if (!imageGenerationEnabled) {
                      setSearchEnabled(false)
                      setDeepResearchEnabled(false)
                      setBrowserEnabled(false)
                      setReasoningEnabled(false)
                    }
                  }}
                  isBrowserSupported={isBrowserSupported}
                  toggleInstruct={() => {
                    toggleInstruct()
                    setImageGenerationEnabled(false)
                  }}
                  isSupportTools={isSupportTools}
                  isSupportDeepResearch={isSupportDeepResearch}
                  isSupportReasoningToggle={isSupportInstruct}
                  isSupportImageGeneration={isSupportImageGeneration}
                >
                  <Button
                    className="rounded-full mx-1 size-8"
                    variant="secondary"
                    size="icon"
                  >
                    <Settings2 className="size-4 text-muted-foreground" />
                  </Button>
                </SettingChatInput>
                {isSupportInstruct &&
                  reasoningEnabled &&
                  !deepResearchEnabled &&
                  !imageGenerationEnabled && (
                    <PromptInputButton
                      variant="outline"
                      className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                      disabled={status === CHAT_STATUS.STREAMING}
                      onClick={() => {
                        toggleInstruct()
                        setImageGenerationEnabled(false)
                      }}
                    >
                      <LightbulbIcon className="text-primary size-4 group-hover:hidden" />
                      <X className="text-primary size-4 hidden group-hover:block" />
                      <span className="text-primary">Think</span>
                    </PromptInputButton>
                  )}
                {searchEnabled && !deepResearchEnabled && !imageGenerationEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === CHAT_STATUS.STREAMING}
                    onClick={toggleSearch}
                  >
                    <GlobeIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">Search</span>
                  </PromptInputButton>
                )}
                {deepResearchEnabled && !imageGenerationEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === CHAT_STATUS.STREAMING}
                    onClick={toggleDeepResearch}
                  >
                    <MegaphoneIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">Deep Research</span>
                  </PromptInputButton>
                )}
                {browserEnabled && shouldShowBrowserUI && !imageGenerationEnabled && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PromptInputButton
                        variant="outline"
                        className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                        disabled={status === CHAT_STATUS.STREAMING}
                        onClick={toggleBrowser}
                      >
                        <div className="size-4 flex items-center justify-center group-hover:hidden">
                          {browserConnectionState === CONNECTION_STATE.ERROR && (
                            <div className="size-3 bg-red-400 rounded-full" />
                          )}
                          {browserConnectionState === CONNECTION_STATE.CONNECTING && (
                            <div className="size-3 animate-pulse bg-blue-400 rounded-full" />
                          )}
                          {browserConnectionState === CONNECTION_STATE.CONNECTED && (
                            <div className="size-3 bg-green-400 rounded-full" />
                          )}
                        </div>
                        <X className="text-primary size-4 hidden group-hover:block" />
                        <span className="text-primary">Browse</span>
                      </PromptInputButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {browserConnectionState === CONNECTION_STATE.ERROR && (
                        <p>Connection error</p>
                      )}
                      {browserConnectionState === CONNECTION_STATE.CONNECTING && (
                        <p>Connecting...</p>
                      )}
                      {browserConnectionState === CONNECTION_STATE.CONNECTED && (
                        <p>Ready to use</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                {selectedProjectId && !isPrivateChat && !imageGenerationEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === CHAT_STATUS.STREAMING}
                    onClick={() => setSelectedProjectId(null)}
                  >
                    <FolderIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">
                      {projects.find((p) => p.id === selectedProjectId)?.name ||
                        'Project'}
                    </span>
                  </PromptInputButton>
                )}
                {isSupportImageGeneration && imageGenerationEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === CHAT_STATUS.STREAMING}
                    onClick={() => {
                      toggleImageGeneration()
                      // Re-enable other capabilities when image generation is toggled off
                    }}
                  >
                    <ImageIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">Create Image</span>
                  </PromptInputButton>
                )}
              </PromptInputTools>
              <div className="flex items-center gap-2">
                {/* Disabled speech input button */}
                {/* <PromptInputSpeechButton textareaRef={textareaRef} /> */}
                <PromptInputSubmit
                  status={status}
                  className="rounded-full"
                  variant={
                    status === CHAT_STATUS.STREAMING || status === CHAT_STATUS.SUBMITTED
                      ? 'destructive'
                      : 'default'
                  }
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
          {(status === CHAT_STATUS.STREAMING || status === CHAT_STATUS.SUBMITTED) && (
            <div className="absolute inset-0 ">
              <BorderAnimate rx="10%" ry="10%">
                <div
                  className={cn(
                    'h-100 w-100 bg-[radial-gradient(var(--primary),transparent_50%)]'
                  )}
                />
              </BorderAnimate>
            </div>
          )}
        </PromptInputProvider>
        {/* {status !== CHAT_STATUS.STREAMING && (
        <div className="absolute inset-0 scale-90 opacity-50 dark:opacity-25 blur-xl transition-all duration-100">
          <div className="bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-0 bottom-0 top-6 from-pink-300 to-purple-300" />
        </div>
      )} */}
      </div>
      {conversationId && (
        <div className="mt-2 text-xs text-muted-foreground text-center">
          <p>Jan can make mistakes. Please double check responses.</p>
        </div>
      )}
    </div>
  )
}

export default memo(ChatInput)
