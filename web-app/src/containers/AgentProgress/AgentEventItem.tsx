import type { OpenCodeEvent } from '@/services/opencode/types'
import {
  FileText,
  Search,
  Edit3,
  Terminal,
  FolderOpen,
  CheckCircle,
  Play,
  Type,
  Brain,
  FileEdit,
} from 'lucide-react'

interface AgentEventItemProps {
  event: OpenCodeEvent
}

/**
 * Get icon for tool type
 */
function getToolIcon(tool: string) {
  const iconClass = 'w-3 h-3'

  switch (tool.toLowerCase()) {
    case 'read':
    case 'read_file':
      return <FileText className={iconClass} />
    case 'search':
    case 'grep':
    case 'find':
      return <Search className={iconClass} />
    case 'edit':
    case 'write':
    case 'write_file':
      return <Edit3 className={iconClass} />
    case 'bash':
    case 'shell':
    case 'terminal':
      return <Terminal className={iconClass} />
    case 'list':
    case 'list_directory':
    case 'ls':
      return <FolderOpen className={iconClass} />
    default:
      return <Terminal className={iconClass} />
  }
}

/**
 * Format tool input for display
 */
function formatToolInput(input: unknown): string {
  if (!input) return ''

  if (typeof input === 'string') return input

  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>

    // Common patterns
    if (obj.path) return String(obj.path)
    if (obj.file) return String(obj.file)
    if (obj.command) return String(obj.command)
    if (obj.query) return String(obj.query)
    if (obj.pattern) return String(obj.pattern)

    // Fallback: JSON stringify
    return JSON.stringify(input).slice(0, 100)
  }

  return String(input)
}

export function AgentEventItem({ event }: AgentEventItemProps) {
  switch (event.type) {
    case 'session.started':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Play className="w-3 h-3 text-green-500" />
          <span>Session started</span>
        </div>
      )

    case 'step.started':
      return (
        <div className="flex items-center gap-2 text-xs font-medium py-1 mt-2 border-t pt-2">
          <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">
            Step {event.step}
          </span>
        </div>
      )

    case 'step.completed':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <CheckCircle className="w-3 h-3 text-green-500" />
          <span>Step {event.step} completed</span>
        </div>
      )

    case 'tool.started':
      return (
        <div className="flex items-start gap-2 text-xs py-1 bg-muted/30 rounded px-2">
          <div className="flex items-center gap-1 text-blue-500 shrink-0 mt-0.5">
            {getToolIcon(event.tool)}
            <span className="font-medium">{event.tool}</span>
          </div>
          <span className="text-muted-foreground truncate">
            {formatToolInput(event.input)}
          </span>
        </div>
      )

    case 'tool.completed':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5 pl-4">
          <CheckCircle className="w-2.5 h-2.5 text-green-500" />
          <span className="truncate">{event.title || 'Done'}</span>
        </div>
      )

    case 'text.delta':
      // Skip text deltas - they'll be shown as the final text
      return null

    case 'text.complete':
      return (
        <div className="text-xs py-1 flex items-start gap-2">
          <Type className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-foreground whitespace-pre-wrap line-clamp-3">
            {event.text.slice(0, 200)}
            {event.text.length > 200 && '...'}
          </span>
        </div>
      )

    case 'reasoning.delta':
      return (
        <div className="text-xs py-0.5 flex items-start gap-2 opacity-60">
          <Brain className="w-3 h-3 text-purple-500 shrink-0 mt-0.5" />
          <span className="italic text-muted-foreground line-clamp-2">
            {event.text.slice(0, 100)}
          </span>
        </div>
      )

    case 'file.changed':
      return (
        <div className="flex items-center gap-2 text-xs py-1 text-orange-600 dark:text-orange-400">
          <FileEdit className="w-3 h-3" />
          <span className="truncate font-medium">{event.path}</span>
        </div>
      )

    default:
      return null
  }
}
