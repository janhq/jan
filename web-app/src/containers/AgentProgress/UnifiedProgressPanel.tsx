/**
 * Unified Progress Panel
 *
 * Displays progress for both:
 * 1. AI SDK orchestrator events
 * 2. OpenCode subprocess events
 *
 * This is an enhanced version of AgentProgressPanel that supports
 * the unified event stream from useOrchestratorState.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  FileText,
  Zap,
  Code,
  Brain,
  Wrench,
  ArrowRight,
} from 'lucide-react'
import {
  useOrchestratorState,
  useOrchestratorStatus,
  useOrchestratorEvents,
  useActiveDelegation,
  usePendingApproval,
} from '@/hooks/useOrchestratorState'
import { UnifiedEventItem } from './UnifiedEventItem'
import { UnifiedPermissionDialog } from '../UnifiedPermissionDialog'
import type { OrchestratorStatus } from '@/lib/agents/types'

// ============================================================================
// Status Configuration
// ============================================================================

const statusConfig: Record<
  OrchestratorStatus,
  {
    icon: React.ReactNode
    label: string
    color: string
  }
> = {
  idle: {
    icon: <Bot size={16} />,
    label: 'Ready',
    color: 'text-muted-foreground',
  },
  thinking: {
    icon: <Brain className="animate-pulse" size={16} />,
    label: 'Thinking...',
    color: 'text-blue-500',
  },
  executing_tool: {
    icon: <Wrench className="animate-spin" size={16} />,
    label: 'Executing tool...',
    color: 'text-yellow-500',
  },
  delegating: {
    icon: <Code className="animate-pulse" size={16} />,
    label: 'Delegating to OpenCode...',
    color: 'text-purple-500',
  },
  waiting_approval: {
    icon: <AlertCircle size={16} />,
    label: 'Waiting for approval',
    color: 'text-orange-500',
  },
  completed: {
    icon: <CheckCircle size={16} />,
    label: 'Completed',
    color: 'text-green-500',
  },
  error: {
    icon: <XCircle size={16} />,
    label: 'Error',
    color: 'text-red-500',
  },
}

// ============================================================================
// Component
// ============================================================================

interface UnifiedProgressPanelProps {
  /** Optional class name */
  className?: string

  /** Callback when cancel is clicked */
  onCancel?: () => void
}

export function UnifiedProgressPanel({
  className = '',
  onCancel,
}: UnifiedProgressPanelProps) {
  const status = useOrchestratorStatus()
  const events = useOrchestratorEvents()
  const activeDelegation = useActiveDelegation()
  const pendingApproval = usePendingApproval()
  const { setPendingApproval, reset } = useOrchestratorState()

  const [isExpanded, setIsExpanded] = useState(true)
  const [isResponding, setIsResponding] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const eventsContainerRef = useRef<HTMLDivElement>(null)

  // Get file changes from events - memoized
  const fileChanges = useMemo(() =>
    events
      .filter((e) => e.type === 'file.changed')
      .map((e) => (e.data as { path: string }).path),
    [events]
  )

  // Get last delegation result if any
  const lastDelegationResult = useMemo(() =>
    [...events].reverse().find((e) => e.type === 'delegation.completed'),
    [events]
  )

  // Get delegation started event for input details
  const delegationStartedEvent = useMemo(() =>
    [...events].reverse().find((e) => e.type === 'delegation.started'),
    [events]
  )

  // Get input/output details for delegation - with safe access
  const delegationInput = useMemo(() => {
    if (!delegationStartedEvent?.data) return null
    return {
      task: String((delegationStartedEvent.data as { task?: unknown }).task ?? ''),
      agent: String((delegationStartedEvent.data as { agent?: unknown }).agent ?? ''),
      projectPath: String((delegationStartedEvent.data as { projectPath?: unknown }).projectPath ?? ''),
    }
  }, [delegationStartedEvent])

  const delegationOutput = useMemo(() => {
    if (!lastDelegationResult?.data) return null
    return {
      summary: (lastDelegationResult.data as { summary?: unknown }).summary ?? null,
      filesChanged: (lastDelegationResult.data as { filesChanged?: unknown }).filesChanged ?? null,
      tokensUsed: (lastDelegationResult.data as { tokensUsed?: unknown }).tokensUsed ?? null,
      success: (lastDelegationResult.data as { success?: unknown }).success ?? null,
    }
  }, [lastDelegationResult])

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (eventsContainerRef.current && isExpanded) {
      eventsContainerRef.current.scrollTop =
        eventsContainerRef.current.scrollHeight
    }
  }, [events.length, isExpanded])

  // Reset details expanded when a new delegation starts
  useEffect(() => {
    if (activeDelegation?.taskId) {
      setDetailsExpanded(false)
    }
  }, [activeDelegation?.taskId])

  // Note: Visibility is now controlled by the parent component (AgentProgressPanelWrapper)
  // The panel only mounts when LLM decides to use tools, so we don't need to hide here

  const statusInfo = statusConfig[status] || statusConfig.idle
  const isActive = ['thinking', 'executing_tool', 'delegating', 'waiting_approval'].includes(status)

  // Handle approval response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleApprovalResponse = async (_response: {
    approved: boolean
    alwaysAllow?: boolean
    message?: string
  }) => {
    if (!pendingApproval) return

    setIsResponding(true)
    try {
      // The parent component should handle the actual response
      // For now, just clear the pending approval
      setPendingApproval(null)
    } finally {
      setIsResponding(false)
    }
  }

  return (
    <div className={`border-l bg-muted/30 w-80 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="text-primary" size={18} />
          <div className="flex flex-col">
            <span className="font-medium text-sm">
              {activeDelegation ? `${activeDelegation.agent} agent` : 'Orchestrator'}
            </span>
            <div className={`flex items-center gap-1 text-xs ${statusInfo.color}`}>
              {statusInfo.icon}
              <span>{statusInfo.label}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isActive && onCancel && (
            <button
              onClick={onCancel}
              className="text-xs text-muted-foreground hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            {isExpanded ? (
              <ChevronDown size={16} className="text-muted-foreground" />
            ) : (
              <ChevronUp size={16} className="text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Active delegation info with expandable details */}
          {activeDelegation && (
            <div className="border-b shrink-0">
              {/* Header - always visible */}
              <div className="p-2 bg-purple-500/10">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDetailsExpanded(!detailsExpanded)}
                    className="shrink-0 p-0.5 hover:bg-purple-500/20 rounded transition-colors"
                  >
                    {detailsExpanded ? (
                      <ChevronDown size={14} className="text-purple-500" />
                    ) : (
                      <ChevronRight size={14} className="text-purple-500" />
                    )}
                  </button>
                  <Code className="w-3 h-3 text-purple-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {activeDelegation.agent} agent
                      </span>
                      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-500">
                        OpenCode
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground line-clamp-2">
                      {activeDelegation.task}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono truncate block">
                      {activeDelegation.projectPath}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expandable input/output details */}
              {detailsExpanded && (
                <div className="bg-muted/30">
                  {/* Input section */}
                  <div className="p-2 border-b border-dashed border-purple-500/20">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ArrowRight size={12} className="text-blue-500" />
                      <span className="text-[10px] font-medium text-blue-500">INPUT</span>
                    </div>
                    <div className="pl-5 space-y-1">
                      <div className="text-[10px]">
                        <span className="text-muted-foreground">Task: </span>
                        <span className="font-mono">{delegationInput?.task}</span>
                      </div>
                      <div className="text-[10px]">
                        <span className="text-muted-foreground">Agent: </span>
                        <span className="font-mono">{delegationInput?.agent}</span>
                      </div>
                      <div className="text-[10px] truncate">
                        <span className="text-muted-foreground">Path: </span>
                        <span className="font-mono">{delegationInput?.projectPath}</span>
                      </div>
                    </div>
                  </div>

                  {/* Output section - show when completed */}
                  {delegationOutput && (
                    <div className="p-2">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ArrowRight size={12} className="text-green-500 rotate-180" />
                        <span className="text-[10px] font-medium text-green-500">OUTPUT</span>
                      </div>
                      <div className="pl-5 space-y-1">
                        {delegationOutput.summary && (
                          <div className="text-[10px]">
                            <span className="text-muted-foreground">Summary: </span>
                            <span>{delegationOutput.summary}</span>
                          </div>
                        )}
                        {delegationOutput.filesChanged && (delegationOutput.filesChanged as string[]).length > 0 && (
                          <div className="text-[10px]">
                            <span className="text-muted-foreground">Files: </span>
                            <div className="font-mono pl-2 space-y-0.5 mt-0.5">
                              {(delegationOutput.filesChanged as string[]).map((f: string) => (
                                <div key={f} className="truncate">{f}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {delegationOutput.tokensUsed && (
                          <div className="text-[10px]">
                            <span className="text-muted-foreground">Tokens: </span>
                            <span className="font-mono">{delegationOutput.tokensUsed.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Events list */}
          <div
            ref={eventsContainerRef}
            className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0"
          >
            {events.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">
                Waiting for events...
              </div>
            ) : (
              events.map((event) => (
                <UnifiedEventItem key={event.id} event={event} />
              ))
            )}
          </div>

          {/* Permission Dialog */}
          {pendingApproval && (
            <div className="p-2 border-t shrink-0">
              <UnifiedPermissionDialog
                approval={pendingApproval}
                onRespond={handleApprovalResponse}
                isResponding={isResponding}
              />
            </div>
          )}

          {/* Result summary */}
          {status === 'completed' && lastDelegationResult && (
            <div className="p-3 border-t bg-muted/50 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <CheckCircle className="text-green-500" size={16} />
                <span>Task Completed</span>
              </div>

              {/* Detailed output section */}
              <div className="space-y-2">
                {(lastDelegationResult.data as { summary?: string }).summary && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Summary: </span>
                    <span>{(lastDelegationResult.data as { summary: string }).summary}</span>
                  </div>
                )}

                {fileChanges.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText size={12} />
                      <span className="text-xs font-medium">Files changed ({fileChanges.length})</span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5 ml-5">
                      {fileChanges.slice(0, 5).map((f) => (
                        <li key={f} className="flex items-center gap-1 truncate font-mono">
                          {f}
                        </li>
                      ))}
                      {fileChanges.length > 5 && (
                        <li className="text-muted-foreground/60">
                          +{fileChanges.length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {(lastDelegationResult.data as { tokensUsed?: number }).tokensUsed && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                    <Zap size={12} />
                    <span>
                      {(lastDelegationResult.data as { tokensUsed: number }).tokensUsed.toLocaleString()}{' '}
                      tokens
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {status === 'error' && (
            <div className="p-3 border-t bg-red-500/10 border-red-500/20 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-red-500 mb-1">
                <XCircle size={16} />
                <span>Error</span>
              </div>
              <p className="text-xs text-red-500/80">
                An error occurred during execution. Check the event log for details.
              </p>
            </div>
          )}

          {/* Clear button when completed/error */}
          {(status === 'completed' || status === 'error') && (
            <div className="p-2 border-t shrink-0">
              <button
                onClick={reset}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded border hover:bg-muted transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
