/**
 * Unified Permission Dialog
 *
 * A single dialog component that handles permission requests from both:
 * 1. AI SDK tool approval (needsApproval)
 * 2. OpenCode subprocess permission requests
 *
 * This provides a consistent UX for all approval flows in the orchestrator.
 */

import { useState } from 'react'
import {
  Shield,
  Check,
  X,
  MessageSquare,
  AlertTriangle,
  Code,
  Wrench,
  FileEdit,
  Terminal,
  Search,
} from 'lucide-react'
import type { PendingApproval } from '@/lib/agents/types'

// ============================================================================
// Types
// ============================================================================

interface UnifiedPermissionDialogProps {
  /** The pending approval request */
  approval: PendingApproval

  /** Callback when user responds to the approval */
  onRespond: (response: {
    approved: boolean
    alwaysAllow?: boolean
    message?: string
  }) => void

  /** Whether the dialog is currently processing a response */
  isResponding?: boolean
}

type ApprovalAction = 'approve' | 'approve_always' | 'deny'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get icon for the permission/tool type
 */
function getIcon(name: string) {
  const lowerName = name.toLowerCase()

  if (
    lowerName.includes('opencode') ||
    lowerName.includes('delegate') ||
    lowerName.includes('code')
  ) {
    return Code
  }

  if (
    lowerName.includes('edit') ||
    lowerName.includes('write') ||
    lowerName.includes('file')
  ) {
    return FileEdit
  }

  if (
    lowerName.includes('bash') ||
    lowerName.includes('shell') ||
    lowerName.includes('terminal') ||
    lowerName.includes('exec')
  ) {
    return Terminal
  }

  if (
    lowerName.includes('search') ||
    lowerName.includes('find') ||
    lowerName.includes('grep')
  ) {
    return Search
  }

  return Wrench
}

/**
 * Get styling based on risk level
 */
function getStyle(name: string, type: 'tool' | 'delegation') {
  const lowerName = name.toLowerCase()

  // High risk operations
  const highRisk = ['delete', 'rm', 'remove', 'drop', 'truncate', 'force']
  const isHighRisk = highRisk.some((r) => lowerName.includes(r))

  // Medium risk operations
  const mediumRisk = [
    'edit',
    'write',
    'create',
    'bash',
    'shell',
    'exec',
    'opencode',
    'delegate',
  ]
  const isMediumRisk = mediumRisk.some((r) => lowerName.includes(r))

  if (isHighRisk) {
    return {
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/20',
      iconColor: 'text-red-500',
      BadgeIcon: AlertTriangle,
    }
  }

  if (isMediumRisk || type === 'delegation') {
    return {
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/20',
      iconColor: 'text-yellow-500',
      BadgeIcon: Shield,
    }
  }

  return {
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    iconColor: 'text-blue-500',
    BadgeIcon: Shield,
  }
}

/**
 * Format input for display
 */
function formatInput(input: Record<string, unknown> | undefined): string {
  if (!input) return ''

  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

// ============================================================================
// Component
// ============================================================================

export function UnifiedPermissionDialog({
  approval,
  onRespond,
  isResponding = false,
}: UnifiedPermissionDialogProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showInput, setShowInput] = useState(false)

  const { source, type, request } = approval
  const Icon = getIcon(request.name)
  const style = getStyle(request.name, type)

  const handleAction = (action: ApprovalAction) => {
    const response = {
      approved: action !== 'deny',
      alwaysAllow: action === 'approve_always',
      message: action === 'deny' && feedback.trim() ? feedback : undefined,
    }
    onRespond(response)
  }

  // Title based on source and type
  const title =
    source === 'ai-sdk'
      ? 'Tool Approval Required'
      : type === 'delegation'
        ? 'OpenCode Permission Required'
        : 'Permission Required'

  // Description based on source
  const description =
    source === 'ai-sdk'
      ? `The assistant wants to use the "${request.name}" tool`
      : request.description || `Action: ${request.name}`

  return (
    <div
      className={`rounded-lg border ${style.borderColor} ${style.bgColor} overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit">
        <style.BadgeIcon className={`${style.iconColor} shrink-0`} size={18} />
        <span className="font-medium text-sm">{title}</span>
        <span
          className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
            source === 'ai-sdk'
              ? 'bg-blue-500/20 text-blue-600'
              : 'bg-purple-500/20 text-purple-600'
          }`}
        >
          {source === 'ai-sdk' ? 'AI SDK' : 'OpenCode'}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Tool/Permission Info */}
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-lg ${style.bgColor} border ${style.borderColor}`}
          >
            <Icon className={style.iconColor} size={20} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{request.name}</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          </div>
        </div>

        {/* Patterns (for OpenCode) */}
        {request.patterns && request.patterns.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1">
              Affected files:
            </div>
            <div className="flex flex-wrap gap-1">
              {request.patterns.map((pattern, i) => (
                <span
                  key={i}
                  className="text-[10px] bg-background/50 px-1.5 py-0.5 rounded border font-mono"
                >
                  {pattern}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Input (for AI SDK tools) */}
        {request.input && Object.keys(request.input).length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowInput(!showInput)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <span>{showInput ? 'Hide' : 'Show'} input</span>
              <span className="text-[10px]">
                ({Object.keys(request.input).length} fields)
              </span>
            </button>

            {showInput && (
              <pre className="mt-2 p-2 text-[10px] bg-background/50 rounded border font-mono overflow-auto max-h-32">
                {formatInput(request.input)}
              </pre>
            )}
          </div>
        )}

        {/* Feedback input */}
        {showFeedback && (
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Provide feedback for the agent (optional)..."
            className="w-full mt-3 p-2 text-xs rounded border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={2}
            disabled={isResponding}
          />
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => handleAction('approve')}
            disabled={isResponding}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Check size={14} />
            {source === 'ai-sdk' ? 'Approve' : 'Allow Once'}
          </button>

          <button
            onClick={() => handleAction('approve_always')}
            disabled={isResponding}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Check size={14} />
            Always Allow
          </button>

          <button
            onClick={() => handleAction('deny')}
            disabled={isResponding}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <X size={14} />
            Deny
          </button>

          <button
            onClick={() => setShowFeedback(!showFeedback)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors ml-auto"
            title="Add feedback"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Modal Version
// ============================================================================

interface UnifiedPermissionModalProps extends UnifiedPermissionDialogProps {
  /** Whether the modal is open */
  open: boolean
}

export function UnifiedPermissionModal({
  open,
  approval,
  onRespond,
  isResponding,
}: UnifiedPermissionModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <UnifiedPermissionDialog
          approval={approval}
          onRespond={onRespond}
          isResponding={isResponding}
        />
      </div>
    </div>
  )
}
