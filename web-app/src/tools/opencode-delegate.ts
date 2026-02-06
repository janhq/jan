/**
 * OpenCode Delegate Tool
 *
 * Wraps the OpenCode subprocess as an AI SDK tool for the orchestrator agent.
 * When the LLM decides a task is coding-related, it calls this tool to delegate
 * the work to the OpenCode agent subprocess.
 */

import { jsonSchema, type Tool } from 'ai'
import type {
  OnDelegationProgress,
  OpenCodeAgentType,
  OpenCodeDelegateResult,
  UnifiedAgentEvent,
} from '@/lib/agents/types'
import type { PermissionRequestPayload } from '@/services/opencode/types'
import { getOpenCodeService } from '@/services/opencode'
import { useOrchestratorState } from '@/hooks/useOrchestratorState'

// ============================================================================
// Types
// ============================================================================

export interface DelegateContext {
  /** Project path for the coding task */
  projectPath: string

  /** Agent type for OpenCode (build/plan/explore) */
  agent?: OpenCodeAgentType

  /** Auto-approve read-only operations */
  autoApproveReadOnly?: boolean

  /** Callback for progress events during delegation */
  onProgress?: OnDelegationProgress

  /** Callback when OpenCode requests permission */
  onPermissionRequest?: (request: PermissionRequestPayload) => Promise<{
    action: 'allow_once' | 'allow_always' | 'deny'
    message?: string
  }>

  /** API key for OpenCode to use (from Jan's model settings) */
  apiKey?: string

  /** Provider identifier (e.g., "anthropic", "openai") */
  providerId?: string

  /** Model identifier (e.g., "claude-sonnet-4-20250514") */
  modelId?: string

  /** Base URL for the provider API */
  baseUrl?: string
}

// ============================================================================
// Tool Description
// ============================================================================

const TOOL_DESCRIPTION = `Delegate complex coding tasks to the OpenCode agent.

USE THIS TOOL WHEN THE TASK INVOLVES:
- Writing, modifying, or refactoring code
- Creating or editing files in a codebase
- Running shell commands (npm, git, cargo, make, build tools, etc.)
- Debugging or fixing bugs in code
- Code review and analysis requiring file changes
- File system operations on source code
- Multi-step development workflows
- Creating new components, modules, or features

DO NOT USE THIS TOOL FOR:
- Simple questions about code (answer directly)
- Explaining code concepts (answer directly)
- Web searches or research (use other tools)
- Document/knowledge base queries (use RAG tools)
- General conversation

The OpenCode agent will autonomously execute the task with full access to:
- Read/write files
- Run shell commands
- Search codebase
- Make code changes

You will receive a summary of changes made when the task completes.`

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a tool operation is read-only
 */
function isReadOnlyOperation(toolName: string): boolean {
  const readOnlyTools = [
    'read',
    'glob',
    'grep',
    'search',
    'find',
    'list',
    'ls',
    'cat',
    'head',
    'tail',
    'view',
    'show',
  ]
  const lowerName = toolName.toLowerCase()
  return readOnlyTools.some((t) => lowerName.includes(t))
}

/**
 * Map OpenCode events to unified event format
 */
function mapOpenCodeEventToUnified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  taskId: string,
  timestamp: number
): UnifiedAgentEvent | null {
  const eventType = event.type

  switch (eventType) {
    case 'tool.started':
      return {
        id: `oc-tool-start-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'tool.started',
        data: {
          tool: event.tool || event.name || 'unknown',
          input: event.input || event.args || {},
        },
      }

    case 'tool.completed':
      return {
        id: `oc-tool-complete-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'tool.completed',
        data: {
          tool: event.tool || event.name || 'unknown',
          output: event.output || event.result,
          duration: event.duration,
          title: event.title,
        },
      }

    case 'tool.error':
      return {
        id: `oc-tool-error-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'tool.error',
        data: {
          tool: event.tool || event.name || 'unknown',
          error: event.error || event.message || 'Unknown error',
        },
      }

    case 'file.changed':
    case 'file.write':
    case 'file.edit':
    case 'file.create':
    case 'file.delete':
      return {
        id: `oc-file-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'file.changed',
        data: {
          path: event.path || event.file,
          diff: event.diff,
          action:
            eventType === 'file.delete'
              ? 'deleted'
              : eventType === 'file.create'
                ? 'created'
                : 'modified',
        },
      }

    case 'text.delta':
      return {
        id: `oc-text-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'text.delta',
        data: {
          text: event.text || event.content || '',
        },
      }

    case 'session.started':
      return {
        id: `oc-session-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'session.started',
        data: {
          sessionId: event.sessionId || taskId,
        },
      }

    case 'reasoning.delta':
      return {
        id: `oc-reasoning-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'reasoning.delta',
        data: {
          text: event.text || event.content || '',
        },
      }

    case 'step.started':
      return {
        id: `oc-step-start-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'step.started',
        data: {
          step: event.step ?? 0,
          agent: event.agent,
        },
      }

    case 'step.completed':
      return {
        id: `oc-step-complete-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'step.completed',
        data: {
          step: event.step ?? 0,
          agent: event.agent,
        },
      }

    case 'text.complete':
      return {
        id: `oc-text-complete-${taskId}-${timestamp}`,
        source: 'opencode',
        timestamp,
        type: 'text.complete',
        data: {
          text: event.text || event.content || '',
        },
      }

    default:
      console.log('[OpenCode Delegate] Unmapped event type:', eventType, event)
      return null
  }
}

// ============================================================================
// Execute Function
// ============================================================================

/**
 * Execute delegation to OpenCode subprocess
 */
async function executeOpenCodeDelegation(
  task: string,
  context: DelegateContext
): Promise<OpenCodeDelegateResult> {
  const { projectPath, agent = 'build', apiKey, providerId, modelId, baseUrl, onProgress, onPermissionRequest, autoApproveReadOnly } = context
  const service = getOpenCodeService()

  // Pre-flight check: verify Jan's local API server is reachable
  if (baseUrl) {
    try {
      const healthUrl = baseUrl.replace(/\/v1\/?$/, '/v1/models')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const headers: Record<string, string> = {}
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }
      const resp = await fetch(healthUrl, { signal: controller.signal, headers }).catch(() => null)
      clearTimeout(timeout)
      if (!resp || !resp.ok) {
        const errorMsg = `Jan's local API server is not reachable at ${baseUrl}. Please start the server in Settings > Local API Server.`
        console.error('[OpenCode Delegate]', errorMsg)
        const { setStatus } = useOrchestratorState.getState()
        setStatus('error')
        onProgress?.({
          id: `preflight-error-${Date.now()}`,
          source: 'opencode',
          timestamp: Date.now(),
          type: 'delegation.error',
          data: { taskId: 'preflight', error: errorMsg },
        })
        return {
          success: false,
          status: 'error' as const,
          filesChanged: [],
          events: [],
          error: errorMsg,
        }
      }
    } catch (e) {
      // If fetch itself throws (e.g., AbortError), the server is unreachable
      const errorMsg = `Jan's local API server is not reachable at ${baseUrl}. Please start the server in Settings > Local API Server.`
      console.error('[OpenCode Delegate]', errorMsg, e)
      const { setStatus } = useOrchestratorState.getState()
      setStatus('error')
      onProgress?.({
        id: `preflight-error-${Date.now()}`,
        source: 'opencode',
        timestamp: Date.now(),
        type: 'delegation.error',
        data: { taskId: 'preflight', error: errorMsg },
      })
      return {
        success: false,
        status: 'error' as const,
        filesChanged: [],
        events: [],
        error: errorMsg,
      }
    }
  }

  // Generate task ID
  const taskId = crypto.randomUUID()

  // Emit delegation started event
  const startEvent: UnifiedAgentEvent = {
    id: `delegation-start-${taskId}`,
    source: 'opencode',
    timestamp: Date.now(),
    type: 'delegation.started',
    data: {
      taskId,
      task,
      agent,
      projectPath,
    },
  }
  // Update orchestrator state
  const { setStatus, setActiveDelegation } = useOrchestratorState.getState()
  setStatus('delegating')
  setActiveDelegation({
    taskId,
    task,
    agent,
    projectPath,
    startedAt: Date.now(),
  })

  // Emit delegation started event via onProgress only (caller adds to orchestrator state)
  onProgress?.(startEvent)

  // Collect events and track state
  const collectedEvents: UnifiedAgentEvent[] = []
  const filesChanged: string[] = []
  let summary: string | undefined
  let tokensUsed: number | undefined

  // Delegation timeout: 5 minutes max to prevent silent stalls
  const DELEGATION_TIMEOUT_MS = 5 * 60 * 1000

  return new Promise((resolve) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let resolved = false

    const safeResolve = (result: OpenCodeDelegateResult) => {
      if (resolved) return
      resolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve(result)
    }

    // Set up timeout to prevent silent stalls (e.g. server unreachable)
    timeoutHandle = setTimeout(() => {
      if (resolved) return
      console.warn('[OpenCode Delegate] Delegation timed out after', DELEGATION_TIMEOUT_MS / 1000, 'seconds')

      // Clean up
      unsubscribe()
      setActiveDelegation(null)
      setStatus('error')

      const timeoutEvent: UnifiedAgentEvent = {
        id: `delegation-timeout-${taskId}`,
        source: 'opencode',
        timestamp: Date.now(),
        type: 'delegation.error',
        data: {
          taskId,
          error: 'Delegation timed out. Is Jan\'s local API server running? Check Settings > Local API Server.',
        },
      }
      onProgress?.(timeoutEvent)

      safeResolve({
        success: false,
        status: 'error',
        filesChanged,
        events: collectedEvents,
        error: 'Delegation timed out. The local API server may not be running.',
      })

      // Try to cancel the task
      service.cancelTask(taskId).catch(() => {})
    }, DELEGATION_TIMEOUT_MS)

    // Set up event listener BEFORE starting task
    const { unsubscribe, ready: listenerReady } = service.onEvent(taskId, async (message) => {
      const timestamp = Date.now()
      console.log('[OpenCode Delegate] Received message:', message.type, taskId)

      try {
      switch (message.type) {
        case 'ready': {
          console.log('[OpenCode Delegate] OpenCode ready for task:', taskId)
          break
        }

        case 'event': {
          const eventData = message.payload.event

          // Map subprocess events to unified events
          const unifiedEvent = mapOpenCodeEventToUnified(
            eventData,
            taskId,
            timestamp
          )
          if (unifiedEvent) {
            collectedEvents.push(unifiedEvent)
            onProgress?.(unifiedEvent)

            // Track file changes
            if (eventData.type === 'file.changed') {
              const path = (eventData as { path: string }).path
              if (path && !filesChanged.includes(path)) {
                filesChanged.push(path)
              }
            }
          }
          break
        }

        case 'permission_request': {
          // Handle permission request
          const permRequest = message.payload

          // Emit approval requested event
          const approvalEvent: UnifiedAgentEvent = {
            id: `approval-${permRequest.permissionId}`,
            source: 'opencode',
            timestamp,
            type: 'tool.approval_requested',
            data: {
              toolCallId: permRequest.permissionId,
              tool: permRequest.permission,
              input: permRequest.metadata || {},
              description: permRequest.description,
            },
          }
          onProgress?.(approvalEvent)

          // Check if auto-approve is enabled for read-only
          if (autoApproveReadOnly && isReadOnlyOperation(permRequest.permission)) {
            await service.respondToPermission(
              taskId,
              permRequest.permissionId,
              'allow_once'
            )
            const autoApproveEvent: UnifiedAgentEvent = {
              id: `approval-response-${permRequest.permissionId}`,
              source: 'opencode',
              timestamp: Date.now(),
              type: 'tool.approval_responded',
              data: {
                toolCallId: permRequest.permissionId,
                tool: permRequest.permission,
                approved: true,
                message: 'Auto-approved (read-only)',
              },
            }
            onProgress?.(autoApproveEvent)
          } else if (onPermissionRequest) {
            // Request user approval
            setStatus('waiting_approval')
            const response = await onPermissionRequest(permRequest)

            await service.respondToPermission(
              taskId,
              permRequest.permissionId,
              response.action,
              response.message
            )

            const responseEvent: UnifiedAgentEvent = {
              id: `approval-response-${permRequest.permissionId}`,
              source: 'opencode',
              timestamp: Date.now(),
              type: 'tool.approval_responded',
              data: {
                toolCallId: permRequest.permissionId,
                tool: permRequest.permission,
                approved: response.action !== 'deny',
                message: response.message,
              },
            }
            onProgress?.(responseEvent)
            setStatus('delegating')
          } else {
            // No permission handler - deny by default
            await service.respondToPermission(taskId, permRequest.permissionId, 'deny')
          }
          break
        }

        case 'result': {
          // Task completed
          const result = message.payload
          summary = result.summary
          tokensUsed = result.tokensUsed

          // Clean up
          unsubscribe()
          setActiveDelegation(null)
          setStatus('completed')

          // Emit completion event
          const completionEvent: UnifiedAgentEvent = {
            id: `delegation-complete-${taskId}`,
            source: 'opencode',
            timestamp: Date.now(),
            type: 'delegation.completed',
            data: {
              taskId,
              success: result.status === 'completed',
              summary,
              filesChanged,
              tokensUsed,
            },
          }
          onProgress?.(completionEvent)

          safeResolve({
            success: result.status === 'completed',
            status: result.status,
            summary,
            filesChanged,
            tokensUsed,
            events: collectedEvents,
          })
          break
        }

        case 'error': {
          // Task failed
          const error = message.payload

          // Clean up
          unsubscribe()
          setActiveDelegation(null)
          setStatus('error')

          // Emit error event
          const errorEvent: UnifiedAgentEvent = {
            id: `delegation-error-${taskId}`,
            source: 'opencode',
            timestamp: Date.now(),
            type: 'delegation.error',
            data: {
              taskId,
              error: error.message || 'Unknown error',
            },
          }
          onProgress?.(errorEvent)

          safeResolve({
            success: false,
            status: 'error',
            filesChanged,
            events: collectedEvents,
            error: error.message,
          })
          break
        }
      }
      } catch (err) {
        console.error('[OpenCode Delegate] Error in event handler:', err)
      }
    })

    // Wait for the Tauri listener to be fully registered before starting the task.
    // Without this, events emitted by the backend can be lost in a race condition.
    listenerReady.then(async () => {
      try {
        await service.startTask({
          taskId,
          projectPath,
          prompt: task,
          agent,
          apiKey,
          providerId,
          modelId,
          baseUrl,
        })
      } catch (error) {
        unsubscribe()
        setActiveDelegation(null)
        setStatus('error')

        const errorEvent: UnifiedAgentEvent = {
          id: `delegation-error-${taskId}`,
          source: 'opencode',
          timestamp: Date.now(),
          type: 'delegation.error',
          data: {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          },
        }
        onProgress?.(errorEvent)

        safeResolve({
          success: false,
          status: 'error',
          filesChanged: [],
          events: collectedEvents,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create the OpenCode delegate tool
 *
 * @param context - Context with callbacks for events and permissions
 * @returns AI SDK tool definition
 */
export function createOpenCodeDelegateTool(context: DelegateContext): Tool {
  return {
    description: TOOL_DESCRIPTION,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The coding task to perform, described in detail',
        },
        agent: {
          type: 'string',
          enum: ['build', 'plan', 'explore'],
          description:
            'Agent type: build (default - can modify files), plan (read-only analysis), explore (search and navigation)',
        },
      },
      required: ['task'],
    }),
    execute: (() => {
      // Track delegation attempts to prevent the LLM from retrying on error.
      // When the tool fails once, the LLM sees the error result and often
      // decides to call the tool again, causing duplicate subprocesses.
      let delegationAttempted = false

      return async (input: { task: string; agent?: string }) => {
        const { task, agent } = input
        console.log('[OpenCode Delegate] Tool execute called with input:', JSON.stringify(input).slice(0, 200))

        // Prevent duplicate delegations within the same conversation turn
        if (delegationAttempted) {
          console.log('[OpenCode Delegate] Blocking retry — already attempted delegation this turn')
          return 'OpenCode delegation was already attempted for this conversation. Do NOT call opencode_delegate again. Instead, inform the user about the previous error and suggest they check their configuration.'
        }
        delegationAttempted = true

        try {
          const result = await executeOpenCodeDelegation(task, {
            ...context,
            agent: (agent as OpenCodeAgentType) || context.agent || 'build',
          })
          console.log('[OpenCode Delegate] Result:', JSON.stringify({
            success: result.success,
            status: result.status,
            summary: result.summary?.slice(0, 100),
            filesChanged: result.filesChanged,
            error: result.error,
          }))

          // Always return a string result — never throw.
          // AI SDK feeds this back to the model for a final response.
          if (result.success) {
            const parts = []
            if (result.summary) {
              parts.push(`Summary: ${result.summary}`)
            }
            if (result.filesChanged.length > 0) {
              parts.push(`Files changed: ${result.filesChanged.join(', ')}`)
            }
            if (result.tokensUsed) {
              parts.push(`Tokens used: ${result.tokensUsed}`)
            }
            return parts.length > 0
              ? parts.join('\n')
              : 'Task completed successfully.'
          } else {
            return `Task failed: ${result.error || 'Unknown error'}. Do NOT retry this delegation — report the error to the user instead.`
          }
        } catch (error) {
          // Catch any exception and return it as a string result instead of throwing.
          // Throwing would put the tool in 'output-error' state and show as "Failed" in the chat.
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error('[OpenCode Delegate] Execute exception:', errorMessage, error)
          return `OpenCode delegation error: ${errorMessage}. Do NOT retry — inform the user about this error.`
        }
      }
    })(),
  }
}
