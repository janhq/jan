import { createChatRunStream, type ChatRunInbox, type ChatToolOutcome } from '@/lib/chatRunTransport'
import type { PendingToolCall } from '@/lib/coworkRunner'
import { generateId } from 'ai'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { trackChat, observeChatWork } from '@/lib/chatClose'
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
import { cancelChatOrchestration } from '@/lib/chatOrchestration'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    dispatchTool?: (call: PendingToolCall, signal: AbortSignal) => Promise<ChatToolOutcome>
    /** Per-run inbox lane for child completions / monitor pings. */
    runInbox?: () => ChatRunInbox | undefined
    sessionId?: string
    sessionTitle?: string
    systemMessage?: string
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void;
  }

const admissions = new WeakMap<object, () => void>()

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
    dispatchTool,
    runInbox,
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
      () => {
        const pending = new Set<Promise<unknown>>()
        const instance = new Chat({
          ...chatInitOptions,
          transport: {
            reconnectToStream: (request) => transport.reconnectToStream(request),
            sendMessages: async (request) => {
              const abort = new AbortController()
              const releaseSnapshot = transport.beginChatRun(() => abort.abort('Turn replaced'))
              admissions.get(instance)?.()
              admissions.delete(instance)
              const stop = () => {
                abort.abort(request.abortSignal?.reason)
                // User Stop: children abort with the run; stop only monitors this lane started.
                void cancelChatOrchestration(sessionId)
                useToolApprovalRequests.getState().clearPendingForThread(sessionId)
              }
              request.abortSignal?.addEventListener('abort', stop, { once: true })
              if (request.abortSignal?.aborted) stop()
              const unwatch = useChatSessions.subscribe(state => {
                if (!state.sessions[sessionId]) {
                  abort.abort('Thread deleted')
                  useToolApprovalRequests.getState().clearPendingForThread(sessionId)
                }
              })
              return createChatRunStream({
                messages: request.messages,
                messageId: generateId(),
                signal: abort.signal,
                // Read after first send resolves its frozen model selection,
                // not the previous turn's model or mutable global selection.
                getModelContextTokens: () => {
                  const value = transport.getTurnModelSelection()?.selectedModel?.settings?.ctx_len?.controller_props?.value
                  return typeof value === 'number' ? value : undefined
                },
                sendStep: (messages, signal) => transport.sendMessages({ ...request, messages, abortSignal: signal }),
                inbox: runInbox?.(),
                dispatch: dispatchTool ?? (async () => ({ output: 'Chat tool executor unavailable', isError: true })),
                onFinally: () => {
                  releaseSnapshot()
                  useToolApprovalRequests.getState().clearPendingForThread(sessionId)
                  unwatch()
                  request.abortSignal?.removeEventListener('abort', stop)
                },
              })
            },
          },
          onFinish: (event) => observeChatWork(pending, () => chatInitOptions.onFinish?.(event)),
          // runTurn is the sole follow-up authority; SDK auto-send would
          // execute a second model request for the same settled tool wave.
          sendAutomaticallyWhen: undefined,
        })
        // SDK serializes state updates, not whole requests. Guard BEFORE it
        // mutates messages/activeResponse so a queued send cannot steal Stop
        // from an approval or tool still owned by the current turn.
        const send = instance.sendMessage.bind(instance)
        const regenerate = instance.regenerate.bind(instance)
        let reservation: object | undefined
        const busy = () => reservation !== undefined || instance.status === 'submitted' || instance.status === 'streaming'
        const start = (operation: () => Promise<void>, error: string) => {
          if (busy()) return Promise.reject(new Error(error))
          // SDK text/FileList conversion may yield before status=submitted.
          // Reserve synchronously, before invoking any SDK mutation.
          const owner = {}
          reservation = owner
          try {
            const settled = operation().finally(() => {
              if (reservation === owner) reservation = undefined
            })
            transport.trackChatOperation(settled)
            return settled
          } catch (cause) {
            if (reservation === owner) reservation = undefined
            return Promise.reject(cause)
          }
        }
        instance.sendMessage = (...args) => start(() => send(...args), 'Chat turn already running')
        instance.regenerate = (...args) => start(() => regenerate(...args), 'Stop the current Chat turn before regenerating')
        trackChat(instance, pending)
        return instance
      },
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

  // Composer submission waits for admission, not the entire model/tool run.
  // The retained Chat still exposes/tracks the full operation for Stop/close.
  const sendMessageAccepted = useCallback<typeof chatResult.sendMessage>(async (...args) => {
    const retained = sessionId ? useChatSessions.getState().sessions[sessionId]?.chat : undefined
    const owner = retained ?? chatResult
    if ((retained && admissions.has(retained)) || owner.status === 'submitted' || owner.status === 'streaming') {
      throw new Error('Chat turn already running')
    }
    if (!retained) throw new Error('Chat session unavailable')
    await new Promise<void>((resolve, reject) => {
      admissions.set(retained, resolve)
      const operation = retained.sendMessage(...args)
      // Transport entry acknowledges SDK enqueue before streaming/dispatch.
      // Preflight rejection still reaches the route's rollback; accepted runs
      // remain tracked by trackChat independently for Stop/close finalization.
      void operation.then(() => {
        admissions.delete(retained)
        resolve()
      }, error => {
        admissions.delete(retained)
        reject(error)
      })
    })
  }, [sessionId, chatResult])

  return {
    ...chatResult,
    sendMessage: sendMessageAccepted,
    updateRagToolsAvailability,
    setContinueFromContent,
  }
}
