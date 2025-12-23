import { CustomChatTransport } from '@/lib/custom-chat-transport'
import { useCapabilities } from '@/stores/capabilities-store'
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from '@ai-sdk/react'
import { type ChatInit, type LanguageModel } from 'ai'
import { useEffect, useRef } from 'react'
import { useChatSessions } from '@/stores/chat-session-store'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    sessionId?: string
    sessionTitle?: string
  }

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(model: LanguageModel, options?: CustomChatOptions) {
  const transportRef = useRef<CustomChatTransport | undefined>(undefined) // Using a ref here so we can update the model used in the transport without having to reload the page or recreate the transport
  const {
    sessionId,
    sessionTitle,
    experimental_throttle,
    resume,
    ...chatInitOptions
  } = options ?? {}
  const ensureSession = useChatSessions((state) => state.ensureSession)
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle)
  const updateStatus = useChatSessions((state) => state.updateStatus)
  const searchEnabled = useCapabilities((state) => state.searchEnabled)
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const browserEnabled = useCapabilities((state) => state.browserEnabled)

  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined

  if (!transportRef.current) {
    transportRef.current =
      existingSessionTransport ??
      new CustomChatTransport(model, searchEnabled || deepResearchEnabled)
  } else if (
    existingSessionTransport &&
    transportRef.current !== existingSessionTransport
  ) {
    transportRef.current = existingSessionTransport
  }

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateModel(model)
    }
  }, [model])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateSearchEnabled(
        searchEnabled || deepResearchEnabled
      )
    }
  }, [searchEnabled, deepResearchEnabled])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateBrowseEnabled(browserEnabled)
    }
  }, [browserEnabled])

  const chat = sessionId
    ? ensureSession(
        sessionId,
        transportRef.current,
        () => new Chat({ ...chatInitOptions, transport: transportRef.current }),
        sessionTitle
      )
    : undefined

  useEffect(() => {
    if (sessionId && sessionTitle) {
      setSessionTitle(sessionId, sessionTitle)
    }
  }, [sessionId, sessionTitle, setSessionTitle])

  const chatResult = useChatSDK({
    ...(chat
      ? { chat }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle,
    resume: sessionId ? true : resume,
  })

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status)
    }
  }, [sessionId, chatResult.status, updateStatus])

  return chatResult
}
