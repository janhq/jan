/**
 * Unified Event Item
 *
 * Renders a single event from the unified event stream.
 * Supports both AI SDK and OpenCode event types.
 */

import { useState } from 'react'
import {
  Play,
  CheckCircle,
  XCircle,
  FileEdit,
  ChevronRight,
  ChevronDown,
  Wrench,
  Search,
  Terminal,
  MessageSquare,
  Brain,
  Loader2,
  Code,
  AlertTriangle,
  FileText,
  Folder,
} from 'lucide-react'
import type { UnifiedAgentEvent, UnifiedEventType } from '@/lib/agents/types'

// ============================================================================
// Icon Mapping
// ============================================================================

function getEventIcon(type: UnifiedEventType, toolName?: string) {
  // Tool-specific icons
  if (toolName) {
    const lowerName = toolName.toLowerCase()
    if (lowerName.includes('read') || lowerName.includes('file')) {
      return FileText
    }
    if (lowerName.includes('write') || lowerName.includes('edit')) {
      return FileEdit
    }
    if (lowerName.includes('search') || lowerName.includes('grep') || lowerName.includes('glob')) {
      return Search
    }
    if (lowerName.includes('bash') || lowerName.includes('shell') || lowerName.includes('exec')) {
      return Terminal
    }
    if (lowerName.includes('list') || lowerName.includes('dir')) {
      return Folder
    }
    if (lowerName.includes('opencode') || lowerName.includes('delegate')) {
      return Code
    }
  }

  // Event type icons
  switch (type) {
    case 'tool.started':
      return Loader2
    case 'tool.completed':
      return CheckCircle
    case 'tool.error':
      return XCircle
    case 'tool.approval_requested':
      return AlertTriangle
    case 'tool.approval_responded':
      return CheckCircle
    case 'text.delta':
    case 'text.complete':
      return MessageSquare
    case 'file.changed':
      return FileEdit
    case 'step.started':
      return Play
    case 'step.completed':
      return CheckCircle
    case 'delegation.started':
      return Code
    case 'delegation.completed':
      return CheckCircle
    case 'delegation.error':
      return XCircle
    case 'session.started':
      return Play
    case 'reasoning.delta':
      return Brain
    default:
      return Wrench
  }
}

function getEventColor(type: UnifiedEventType, source: 'ai-sdk' | 'opencode') {
  switch (type) {
    case 'tool.started':
    case 'step.started':
    case 'session.started':
    case 'delegation.started':
      return 'text-blue-500'
    case 'tool.completed':
    case 'step.completed':
    case 'delegation.completed':
    case 'tool.approval_responded':
      return 'text-green-500'
    case 'tool.error':
    case 'delegation.error':
      return 'text-red-500'
    case 'tool.approval_requested':
      return 'text-orange-500'
    case 'file.changed':
      return 'text-yellow-500'
    case 'reasoning.delta':
      return 'text-purple-500'
    case 'text.delta':
    case 'text.complete':
      return 'text-muted-foreground'
    default:
      return source === 'ai-sdk' ? 'text-blue-400' : 'text-purple-400'
  }
}

// ============================================================================
// Component
// ============================================================================

interface UnifiedEventItemProps {
  event: UnifiedAgentEvent
}

export function UnifiedEventItem({ event }: UnifiedEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const Icon = getEventIcon(
    event.type,
    (event.data as { tool?: string }).tool
  )
  const color = getEventColor(event.type, event.source)

  // Skip text delta events (they would flood the UI)
  if (event.type === 'text.delta') {
    return null
  }

  // Format the event content
  const content = formatEventContent(event)
  const details = getEventDetails(event)
  const hasDetails = details !== null

  return (
    <div className="group">
      <div
        className={`flex items-start gap-2 py-1 px-1.5 rounded text-xs hover:bg-muted/50 transition-colors ${
          hasDetails ? 'cursor-pointer' : ''
        }`}
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
      >
        {/* Expand/collapse button or icon */}
        {hasDetails ? (
          <button className="shrink-0 mt-0.5">
            {isExpanded ? (
              <ChevronDown size={12} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={12} className="text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className={`shrink-0 mt-0.5 ${color}`}>
            <Icon
              size={12}
              className={
                event.type === 'tool.started' || event.type === 'delegation.started'
                  ? 'animate-spin'
                  : ''
              }
            />
          </span>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className={hasDetails ? 'font-medium' : ''}>{content}</span>

          {/* Source badge */}
          <span
            className={`ml-1.5 text-[9px] px-1 py-0.5 rounded ${
              event.source === 'ai-sdk'
                ? 'bg-blue-500/10 text-blue-500'
                : 'bg-purple-500/10 text-purple-500'
            }`}
          >
            {event.source === 'ai-sdk' ? 'SDK' : 'OC'}
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && hasDetails && (
        <div className="ml-5 mt-1 mb-2 p-2 bg-muted/30 rounded text-[10px] font-mono overflow-auto max-h-48 border border-dashed border-muted-foreground/20">
          {/* Detect if this is bash/terminal output */}
          {(() => {
            const toolName = (event.data as { tool?: string }).tool
            if (toolName?.toLowerCase().includes('bash')) {
              return (
                <div className="flex items-start gap-1.5">
                  <Terminal size={12} className="shrink-0 mt-0.5 text-yellow-500" />
                  <pre className="whitespace-pre-wrap break-all flex-1">{details}</pre>
                </div>
              )
            }
            return <pre className="whitespace-pre-wrap break-all">{details}</pre>
          })()}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function formatEventContent(event: UnifiedAgentEvent): string {
  const data = event.data as unknown as Record<string, unknown>

  switch (event.type) {
    case 'tool.started':
      return `Starting: ${data.tool}`

    case 'tool.completed':
      if (data.title) {
        return `${data.tool}: ${data.title}`
      }
      return `Completed: ${data.tool}`

    case 'tool.error':
      return `Error: ${data.tool} - ${data.error}`

    case 'tool.approval_requested':
      return `Approval needed: ${data.tool}`

    case 'tool.approval_responded':
      return `${data.approved ? 'Approved' : 'Denied'}: ${data.tool}`

    case 'text.complete': {
      const text = data.text as string
      return text.length > 50 ? `${text.slice(0, 50)}...` : text
    }

    case 'file.changed':
      return `Changed: ${data.path}`

    case 'step.started':
      return `Step ${data.step} started`

    case 'step.completed':
      return `Step ${data.step} completed`

    case 'delegation.started':
      return `Delegating: ${(data.task as string).slice(0, 30)}...`

    case 'delegation.completed': {
      const files = data.filesChanged as string[] | undefined
      return files && files.length > 0
        ? `OpenCode completed: ${files.length} files changed`
        : 'OpenCode completed'
    }

    case 'delegation.error':
      return `OpenCode error: ${data.error}`

    case 'session.started':
      return `Session started: ${data.sessionId}`

    case 'reasoning.delta': {
      const reasoning = data.text as string
      return reasoning.length > 40 ? `${reasoning.slice(0, 40)}...` : reasoning
    }

    default:
      return event.type
  }
}

function getEventDetails(event: UnifiedAgentEvent): string | null {
  const data = event.data as unknown as Record<string, unknown>

  switch (event.type) {
    case 'tool.started':
      if (data.input && Object.keys(data.input as object).length > 0) {
        return JSON.stringify(data.input, null, 2)
      }
      return null

    case 'tool.completed':
      if (data.output) {
        const output = data.output
        if (typeof output === 'string') {
          // Show full output for bash commands
          return output.length > 1000 ? `${output.slice(0, 1000)}\n... (truncated)` : output
        }
        return JSON.stringify(output, null, 2)
      }
      return null

    case 'tool.error':
      return data.error as string

    case 'text.complete': {
      const text = data.text as string
      if (text.length > 50) {
        return text
      }
      return null
    }

    case 'delegation.started':
      return `Task: ${data.task}\nAgent: ${data.agent}\nPath: ${data.projectPath}`

    case 'delegation.completed': {
      const result: string[] = []
      if (data.summary) result.push(`Summary: ${data.summary}`)
      if (data.filesChanged) {
        result.push(`Files: ${(data.filesChanged as string[]).join(', ')}`)
      }
      if (data.tokensUsed) result.push(`Tokens: ${data.tokensUsed}`)
      return result.length > 0 ? result.join('\n') : null
    }

    case 'file.changed':
      if (data.diff) {
        return data.diff as string
      }
      return null

    default:
      return null
  }
}
