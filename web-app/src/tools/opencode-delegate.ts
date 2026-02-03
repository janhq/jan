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

    default:
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
  const { projectPath, agent = 'build', apiKey, onProgress, onPermissionRequest, autoApproveReadOnly } = context
  const service = getOpenCodeService()

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
  onProgress?.(startEvent)

  // Update orchestrator state
  const { setStatus, setActiveDelegation, addEvent } = useOrchestratorState.getState()
  setStatus('delegating')
  setActiveDelegation({
    taskId,
    task,
    agent,
    projectPath,
    startedAt: Date.now(),
  })
  addEvent(startEvent)

  // Collect events and track state
  const collectedEvents: UnifiedAgentEvent[] = []
  const filesChanged: string[] = []
  let summary: string | undefined
  let tokensUsed: number | undefined

  return new Promise((resolve) => {
    // Set up event listener BEFORE starting task
    const unsubscribe = service.onEvent(taskId, async (message) => {
      const timestamp = Date.now()

      switch (message.type) {
        case 'event': {
          const eventData = message.payload.event

          // Map OpenCode events to unified events
          const unifiedEvent = mapOpenCodeEventToUnified(
            eventData,
            taskId,
            timestamp
          )
          if (unifiedEvent) {
            collectedEvents.push(unifiedEvent)
            onProgress?.(unifiedEvent)
            addEvent(unifiedEvent)

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
          addEvent(approvalEvent)

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
            addEvent(autoApproveEvent)
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
            addEvent(responseEvent)
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
          addEvent(completionEvent)

          resolve({
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
          addEvent(errorEvent)

          resolve({
            success: false,
            status: 'error',
            filesChanged,
            events: collectedEvents,
            error: error.message,
          })
          break
        }
      }
    })

    // Small delay to ensure listener is set up
    setTimeout(async () => {
      try {
        await service.startTask({
          taskId,
          projectPath,
          prompt: task,
          agent,
          apiKey,
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
        addEvent(errorEvent)

        resolve({
          success: false,
          status: 'error',
          filesChanged: [],
          events: collectedEvents,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, 50)
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
    execute: async ({ task, agent }: { task: string; agent?: string }) => {
      console.log('[OpenCode Delegate] Tool executed with task:', task.slice(0, 50), '...')
      const result = await executeOpenCodeDelegation(task, {
        ...context,
        agent: (agent as OpenCodeAgentType) || context.agent || 'build',
      })
      console.log('[OpenCode Delegate] Result:', result.success ? 'success' : 'failed')

      // Return a formatted result for the LLM
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
        return `Task failed: ${result.error || 'Unknown error'}`
      }
    },
  }
}
