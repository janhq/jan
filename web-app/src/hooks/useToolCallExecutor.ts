import { useCallback, useRef } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useChatSessions } from '@/stores/chat-session-store'

type ToolCall = {
  toolName: string
  toolCallId: string
  input: unknown
}

type ToolResult = {
  error?: string
  content?: unknown
}

type ToolOutput = {
  state?: 'output-error'
  tool: string
  toolCallId: string
  errorText?: string
  output?: unknown
}

export function useToolCallExecutor({
  threadId,
  projectId,
  serviceHub,
  addToolOutput,
}: {
  threadId: string
  projectId?: string
  serviceHub: {
    rag: () => { callTool: (args: Record<string, unknown>) => Promise<ToolResult> }
    mcp: () => { callTool: (args: Record<string, unknown>) => Promise<ToolResult> }
  }
  addToolOutput: (output: ToolOutput) => void
}) {
  const toolCallAbortController = useRef<AbortController | null>(null)
  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId)

  const abortToolCalls = useCallback(() => {
    toolCallAbortController.current?.abort()
    toolCallAbortController.current = null
    sessionData.tools = []
  }, [sessionData])

  const executeQueuedToolCalls = useCallback(() => {
    toolCallAbortController.current = new AbortController()
    const signal = toolCallAbortController.current.signal
    const ragToolNames = useAppState.getState().ragToolNames
    const mcpToolNames = useAppState.getState().mcpToolNames

    ;(async () => {
      for (const toolCall of sessionData.tools as ToolCall[]) {
        if (signal.aborted) break
        try {
          const toolName = toolCall.toolName
          const approved = ragToolNames.has(toolName)
            ? true
            : await useToolApproval
                .getState()
                .showApprovalModal(toolName, threadId, toolCall.input)
          if (!approved) {
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: 'Tool execution denied by user',
            })
            continue
          }

          let result
          if (ragToolNames.has(toolName)) {
            result = await serviceHub.rag().callTool({
              toolName,
              arguments: toolCall.input,
              threadId,
              projectId,
              scope: projectId ? 'project' : 'thread',
            })
          } else if (mcpToolNames.has(toolName)) {
            result = await serviceHub.mcp().callTool({
              toolName,
              arguments: toolCall.input,
            })
          } else {
            result = { error: `Tool '${toolName}' not found in any service` }
          }

          if (result.error) {
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: `Error: ${result.error}`,
            })
          } else {
            addToolOutput({
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              output: result.content,
            })
          }
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            console.error('Tool call error:', error)
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: `Error: ${JSON.stringify(error)}`,
            })
          }
        }
      }
      sessionData.tools = []
      toolCallAbortController.current = null
    })().catch((error) => {
      if (error.name !== 'AbortError') {
        console.error('Tool call error:', error)
      }
      sessionData.tools = []
      toolCallAbortController.current = null
    })
  }, [addToolOutput, projectId, serviceHub, sessionData, threadId])

  const enqueueToolCall = useCallback(
    ({ toolCall }: { toolCall: ToolCall }) => {
      const queuedTools = sessionData.tools as ToolCall[]
      queuedTools.push(toolCall)
    },
    [sessionData]
  )

  return { executeQueuedToolCalls, enqueueToolCall, abortToolCalls }
}
