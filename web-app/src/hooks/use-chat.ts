import {
  CustomChatTransport,
  type ContinuationContent,
} from '@/lib/custom-chat-transport'
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from '@ai-sdk/react'
import {
  type ChatInit,
  type LanguageModelUsage,
} from 'ai'
import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/useAppState'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    sessionId?: string
    sessionTitle?: string
    systemMessage?: string
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void;
  }

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(
  options?: CustomChatOptions
) {
  const transportRef = useRef<CustomChatTransport | undefined>(undefined) // Using a ref here so we can update the model used in the transport without having to reload the page or recreate the transport
  // The session transportRef belongs to. The hook outlives a session switch (the
  // thread route is reused), and a turn left running in the background keeps
  // using its own transport, so a session must never inherit another's.
  const transportSessionRef = useRef<string | undefined>(undefined)
  const {
    sessionId,
    sessionTitle,
    systemMessage,
    onTokenUsage,
    ...chatInitOptions
  } = options ?? {}
  const ensureSession = useChatSessions((state) => state.ensureSession)
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle)
  const updateStatus = useChatSessions((state) => state.updateStatus)

  // Get serviceHub and model metadata from app state
  const mcpToolNames = useAppState((state) => state.mcpToolNames)
  const ragToolNames = useAppState((state) => state.ragToolNames)

  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined

  // Create transport immediately with modelId and provider
  if (existingSessionTransport) {
    transportRef.current = existingSessionTransport
  } else if (
    !transportRef.current ||
    transportSessionRef.current !== sessionId
  ) {
    transportRef.current = new CustomChatTransport(systemMessage, sessionId)
  }
  transportSessionRef.current = sessionId
  const transport = transportRef.current

  // Keyed by transport too, so a session switch hands the instructions and
  // callback to the new session's transport.
  useEffect(() => {
    transport.updateSystemMessage(systemMessage)
  }, [transport, systemMessage])

  // Update the token usage callback when it changes
  useEffect(() => {
    transport.setOnTokenUsage(onTokenUsage)
  }, [transport, onTokenUsage])

  // Memoize to prevent calling ensureSession (which has side effects) on every render
  const chat = useMemo(() => {
    if (!sessionId || !transportRef.current) return undefined

    return ensureSession(
      sessionId,
      transportRef.current,
      () => new Chat({ ...chatInitOptions, transport: transportRef.current }),
      sessionTitle
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ensureSession])

  useEffect(() => {
    if (sessionId && sessionTitle) {
      setSessionTitle(sessionId, sessionTitle)
    }
  }, [sessionId, sessionTitle, setSessionTitle])

  const chatResult = useChatSDK({
    ...(chat
      ? { chat }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle: options?.experimental_throttle,
    resume: false,
  })

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status)
    }
  }, [sessionId, chatResult.status, updateStatus])

  // Refresh tools when MCP or RAG tool names change (e.g., when MCP servers start/stop)
  useEffect(() => {
    if (transportRef.current) {
      // Use forceRefreshTools to update the transport's tool cache
      // This ensures the transport has the latest tools when MCP server status changes
      transportRef.current.refreshTools()
    }
  }, [mcpToolNames, ragToolNames])

  const setContinueFromContent = useCallback(
    (content: string | ContinuationContent) => {
      transportRef.current?.setContinueFromContent(content)
    },
    []
  )

  // Expose method to update RAG tools availability. A new identity per
  // transport, so a caller's effect re-runs for a newly opened session's.
  const updateRagToolsAvailability = useCallback(
    async (
      hasDocuments: boolean,
      modelSupportsTools: boolean,
      ragFeatureAvailable: boolean
    ) => {
      await transport.updateRagToolsAvailability(
        hasDocuments,
        modelSupportsTools,
        ragFeatureAvailable
      )
    },
    [transport]
  )

  return {
    ...chatResult,
    updateRagToolsAvailability,
    setContinueFromContent,
  }
}
