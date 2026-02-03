import { useOpenCode, useActiveOpenCodeTask } from '@/hooks/useOpenCode'
import { AgentEventItem } from './AgentEventItem'
import { PermissionDialog } from './PermissionDialog'
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  FileText,
  Zap,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

/**
 * Status icon mapping
 */
const statusConfig = {
  starting: {
    icon: <Loader2 className="animate-spin" size={16} />,
    label: 'Starting...',
    color: 'text-blue-500',
  },
  ready: {
    icon: <Loader2 className="animate-spin" size={16} />,
    label: 'Ready',
    color: 'text-blue-500',
  },
  running: {
    icon: <Loader2 className="animate-spin" size={16} />,
    label: 'Running',
    color: 'text-blue-500',
  },
  waiting_permission: {
    icon: <AlertCircle size={16} />,
    label: 'Waiting',
    color: 'text-yellow-500',
  },
  completed: {
    icon: <CheckCircle size={16} />,
    label: 'Completed',
    color: 'text-green-500',
  },
  cancelled: {
    icon: <XCircle size={16} />,
    label: 'Cancelled',
    color: 'text-gray-500',
  },
  error: {
    icon: <XCircle size={16} />,
    label: 'Error',
    color: 'text-red-500',
  },
}

export function AgentProgressPanel() {
  const activeTask = useActiveOpenCodeTask()
  const respondToPermission = useOpenCode((s) => s.respondToPermission)
  const cancelTask = useOpenCode((s) => s.cancelTask)

  const [isExpanded, setIsExpanded] = useState(true)
  const eventsContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (eventsContainerRef.current && isExpanded) {
      eventsContainerRef.current.scrollTop = eventsContainerRef.current.scrollHeight
    }
  }, [activeTask?.events.length, isExpanded])

  if (!activeTask) {
    return null
  }

  const status = statusConfig[activeTask.status] || statusConfig.running
  const isActive = ['starting', 'ready', 'running', 'waiting_permission'].includes(
    activeTask.status
  )

  return (
    <div className="border-l bg-muted/30 w-80 flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="text-primary" size={18} />
          <div className="flex flex-col">
            <span className="font-medium text-sm">
              {activeTask.agent || 'build'} agent
            </span>
            <div className={`flex items-center gap-1 text-xs ${status.color}`}>
              {status.icon}
              <span>{status.label}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isActive && (
            <button
              onClick={() => cancelTask(activeTask.taskId)}
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
          {/* Task prompt */}
          <div className="p-2 border-b text-xs bg-muted/20 shrink-0">
            <div className="flex items-start gap-2">
              <FileText className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
              <span className="line-clamp-2 text-muted-foreground">
                {activeTask.prompt}
              </span>
            </div>
          </div>

          {/* Events list */}
          <div
            ref={eventsContainerRef}
            className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0"
          >
            {activeTask.events.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">
                Waiting for events...
              </div>
            ) : (
              activeTask.events.map((event, i) => (
                <AgentEventItem key={i} event={event} />
              ))
            )}
          </div>

          {/* Permission Dialog */}
          {activeTask.pendingPermission && (
            <PermissionDialog
              request={activeTask.pendingPermission}
              onRespond={(action, message) =>
                respondToPermission(
                  activeTask.taskId,
                  activeTask.pendingPermission!.permissionId,
                  action,
                  message
                )
              }
            />
          )}

          {/* Result summary */}
          {activeTask.result && (
            <div className="p-3 border-t bg-muted/50 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium mb-1">
                {activeTask.result.status === 'completed' ? (
                  <>
                    <CheckCircle className="text-green-500" size={16} />
                    <span>Task Completed</span>
                  </>
                ) : activeTask.result.status === 'cancelled' ? (
                  <>
                    <XCircle className="text-gray-500" size={16} />
                    <span>Task Cancelled</span>
                  </>
                ) : (
                  <>
                    <XCircle className="text-red-500" size={16} />
                    <span>Task Failed</span>
                  </>
                )}
              </div>

              {activeTask.result.summary && (
                <p className="text-xs text-muted-foreground mb-2">
                  {activeTask.result.summary}
                </p>
              )}

              {activeTask.result.filesChanged &&
                activeTask.result.filesChanged.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium mb-1">Files changed:</div>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {activeTask.result.filesChanged.slice(0, 5).map((f) => (
                        <li key={f} className="flex items-center gap-1 truncate">
                          <FileText size={10} />
                          {f}
                        </li>
                      ))}
                      {activeTask.result.filesChanged.length > 5 && (
                        <li className="text-muted-foreground/60">
                          +{activeTask.result.filesChanged.length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

              {activeTask.result.tokensUsed && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                  <Zap size={12} />
                  <span>{activeTask.result.tokensUsed.toLocaleString()} tokens</span>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {activeTask.error && (
            <div className="p-3 border-t bg-red-500/10 border-red-500/20 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-red-500 mb-1">
                <XCircle size={16} />
                <span>Error: {activeTask.error.code}</span>
              </div>
              <p className="text-xs text-red-500/80">{activeTask.error.message}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export { AgentEventItem } from './AgentEventItem'
export { PermissionDialog } from './PermissionDialog'
export { UnifiedProgressPanel } from './UnifiedProgressPanel'
export { UnifiedEventItem } from './UnifiedEventItem'
