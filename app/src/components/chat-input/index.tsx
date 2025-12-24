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
import { toast } from 'sonner'
import {
  FolderIcon,
  GlobeIcon,
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
  const isBrowserSupported = useMemo(() => isChromeBrowser(), [])
  const shouldShowBrowserUI = isBrowserSupported && !isMobileDevice

  // Auto-focus on chat input when component mounts (desktop only)
  useEffect(() => {
    if (textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }, [isMobile])

  // Auto-focus when assistant finishes responding (desktop only)
  useEffect(() => {
    // Focus when status changes from 'streaming' to idle (assistant finished)
    if (status !== 'streaming' && textareaRef.current && !isMobile) {
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
  const toggleSearch = useCapabilities((state) => state.toggleSearch)
  const toggleDeepResearch = useCapabilities(
    (state) => state.toggleDeepResearch
  )
  const toggleBrowser = useCapabilities((state) => state.toggleBrowser)
  const toggleInstruct = useCapabilities((state) => state.toggleReasoning)
  const hydrateCapabilities = useCapabilities((state) => state.hydrate)
  const setSearchEnabled = useCapabilities((state) => state.setSearchEnabled)
  const setDeepResearchEnabled = useCapabilities(
    (state) => state.setDeepResearchEnabled
  )
  const setBrowserEnabled = useCapabilities((state) => state.setBrowserEnabled)

  const fetchPreferences = useProfile((state) => state.fetchPreferences)
  const pref = useProfile((state) => state.preferences)

  const isSupportTools = modelDetail.supports_tools
  const isSupportReasoning = modelDetail.supports_reasoning
  const isSupportDeepResearch = isSupportTools && isSupportReasoning
  const isSupportInstruct = modelDetail.supports_instruct

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
    if (browserConnectionState === 'disconnected' && browserEnabled) {
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
  }, [])

  useEffect(() => {
    if (pref) {
      hydrateCapabilities(pref.preferences)
    }
  }, [pref, hydrateCapabilities])

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

    if (selectedModel) {
      if (initialConversation) {
        if (isPrivateChat) {
          sessionStorage.setItem(
            `initial-message-temporary`,
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
              `initial-message-${conversation.id}`,
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
  }

  return (
    <div>
      <div
        className={cn(
          'w-full relative rounded-3xl p-[1.5px]',
          !initialConversation &&
            status === 'streaming' &&
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
                disabled={status === 'streaming'}
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
                  disablePreferences={status === 'streaming'}
                  toggleSearch={() => {
                    toggleSearch()
                    setBrowserEnabled(false)
                  }}
                  toggleDeepResearch={() => {
                    toggleDeepResearch()
                    setBrowserEnabled(false)
                  }}
                  toggleBrowser={() => {
                    toggleBrowser()
                    setDeepResearchEnabled(false)
                    setSearchEnabled(false)
                  }}
                  isBrowserSupported={isBrowserSupported}
                  toggleInstruct={toggleInstruct}
                  isSupportTools={isSupportTools}
                  isSupportDeepResearch={isSupportDeepResearch}
                  isSupportReasoningToggle={isSupportInstruct}
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
                  !deepResearchEnabled && (
                    <PromptInputButton
                      variant="outline"
                      className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                      disabled={status === 'streaming'}
                      onClick={toggleInstruct}
                    >
                      <LightbulbIcon className="text-primary size-4 group-hover:hidden" />
                      <X className="text-primary size-4 hidden group-hover:block" />
                      <span className="text-primary">Think</span>
                    </PromptInputButton>
                  )}
                {searchEnabled && !deepResearchEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === 'streaming'}
                    onClick={toggleSearch}
                  >
                    <GlobeIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">Search</span>
                  </PromptInputButton>
                )}
                {deepResearchEnabled && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === 'streaming'}
                    onClick={toggleDeepResearch}
                  >
                    <MegaphoneIcon className="text-primary size-4 group-hover:hidden" />
                    <X className="text-primary size-4 hidden group-hover:block" />
                    <span className="text-primary">Deep Research</span>
                  </PromptInputButton>
                )}
                {browserEnabled && shouldShowBrowserUI && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PromptInputButton
                        variant="outline"
                        className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                        disabled={status === 'streaming'}
                        onClick={toggleBrowser}
                      >
                        <div className="size-4 flex items-center justify-center group-hover:hidden">
                          {browserConnectionState === 'error' && (
                            <div className="size-3 bg-red-400 rounded-full" />
                          )}
                          {browserConnectionState === 'connecting' && (
                            <div className="size-3 animate-pulse bg-blue-400 rounded-full" />
                          )}
                          {browserConnectionState === 'connected' && (
                            <div className="size-3 bg-green-400 rounded-full" />
                          )}
                        </div>
                        <X className="text-primary size-4 hidden group-hover:block" />
                        <span className="text-primary">Browse</span>
                      </PromptInputButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {browserConnectionState === 'error' && (
                        <p>Connection error</p>
                      )}
                      {browserConnectionState === 'connecting' && (
                        <p>Connecting...</p>
                      )}
                      {browserConnectionState === 'connected' && (
                        <p>Ready to use</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                {selectedProjectId && !isPrivateChat && (
                  <PromptInputButton
                    variant="outline"
                    className="rounded-full group transition-all bg-primary/10 hover:bg-primary/10 border-0"
                    disabled={status === 'streaming'}
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
              </PromptInputTools>
              <div className="flex items-center gap-2">
                {/* Disabled speech input button */}
                {/* <PromptInputSpeechButton textareaRef={textareaRef} /> */}
                <PromptInputSubmit
                  status={status}
                  className="rounded-full"
                  variant={status === 'streaming' ? 'destructive' : 'default'}
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
          {status === 'streaming' && (
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
        {/* {status !== 'streaming' && (
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
