/**
 * Permission Request Card
 *
 * A component that renders permission requests in the main chat area.
 * This replaces the sidebar-based permission dialog for better visibility.
 */

import { useState, useEffect } from 'react'
import {
  Shield,
  Check,
  X,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPermissionCoordinator, PermissionRequestPayload, PermissionAction } from '@/utils/permission-coordinator'

// ============================================================================
// Types
// ============================================================================

export interface PermissionRequestMessage {
  id: string
  role: 'assistant'
  type: 'permission-request'
  createdAt: Date
  metadata: {
    permissionId: string
    taskId: string
    toolName: string
    description?: string
    input: Record<string, unknown>
    patterns?: string[]
    riskLevel: 'low' | 'medium' | 'high'
    autoApproved: boolean
    responded: boolean
    response?: {
      action: PermissionAction
      message?: string
      timestamp: number
    }
  }
}

interface PermissionRequestCardProps {
  message: PermissionRequestMessage
  onResponse?: (response: { action: PermissionAction; message?: string }) => void
}

// ============================================================================
// Helpers
// ============================================================================

function getRiskLevel(permission: string): 'low' | 'medium' | 'high' {
  const lower = permission.toLowerCase()
  const highRisk = ['delete', 'rm', 'remove', 'drop', 'truncate', 'force', 'sudo']
  const mediumRisk = ['edit', 'write', 'create', 'bash', 'shell', 'exec', 'run']

  if (highRisk.some((r) => lower.includes(r))) return 'high'
  if (mediumRisk.some((r) => lower.includes(r))) return 'medium'
  return 'low'
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

// ============================================================================
// Component
// ============================================================================

export function PermissionRequestCard({ message, onResponse }: PermissionRequestCardProps) {
  const { permissionId, toolName, description, input, patterns, riskLevel, responded, response } = message.metadata
  const [showInput, setShowInput] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')

  const riskColors = {
    low: {
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      icon: 'text-blue-500',
      badge: 'bg-blue-500/20 text-blue-600',
    },
    medium: {
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/20',
      icon: 'text-yellow-500',
      badge: 'bg-yellow-500/20 text-yellow-600',
    },
    high: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      icon: 'text-red-500',
      badge: 'bg-red-500/20 text-red-600',
    },
  }

  const colors = riskColors[riskLevel]

  const handleAction = async (action: PermissionAction) => {
    if (isSubmitting) return
    setIsSubmitting(true)

    try {
      const coordinator = getPermissionCoordinator()
      coordinator.respondToPermission(permissionId, {
        action,
        message: feedback || undefined,
        timestamp: Date.now(),
      })

      onResponse?.({ action, message: feedback || undefined })
    } finally {
      setIsSubmitting(false)
    }
  }

  // If already responded, show read-only view
  if (responded && response) {
    const isApproved = response.action !== 'deny'

    return (
      <div className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden opacity-75`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-inherit bg-muted/30">
          {isApproved ? (
            <Check className="text-green-500 shrink-0" size={16} />
          ) : (
            <X className="text-red-500 shrink-0" size={16} />
          )}
          <span className="text-sm font-medium">
            {isApproved ? 'Permission Granted' : 'Permission Denied'}
          </span>
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${colors.badge}`}>
            {toolName}
          </span>
        </div>

        {/* Content */}
        <div className="p-3">
          <div className="flex items-start gap-2">
            <Shield className={`${colors.icon} mt-0.5 shrink-0`} size={18} />
            <div className="flex-1">
              <div className="font-medium text-sm">{toolName}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {description || 'Permission request'}
              </p>

              {response.message && (
                <p className="text-xs mt-2 italic text-muted-foreground">
                  "{response.message}"
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Active permission request
  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden animate-pulse-once`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-inherit">
        <AlertTriangle className={`${colors.icon} shrink-0`} size={16} />
        <span className="text-sm font-medium">Permission Required</span>
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${colors.badge}`}>
          {riskLevel.toUpperCase()} RISK
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Tool Info */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${colors.bg} border ${colors.border}`}>
            <Shield className={colors.icon} size={20} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{toolName}</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {description || 'OpenCode is requesting permission to perform this action'}
            </p>
          </div>
        </div>

        {/* Patterns (affected files) */}
        {patterns && patterns.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1.5">
              Affected files:
            </div>
            <div className="flex flex-wrap gap-1">
              {patterns.map((pattern, i) => (
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

        {/* Input Details */}
        {input && Object.keys(input).length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowInput(!showInput)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {showInput ? (
                <>
                  <ChevronUp size={12} /> Hide details
                </>
              ) : (
                <>
                  <ChevronDown size={12} /> Show details ({Object.keys(input).length} fields)
                </>
              )}
            </button>

            {showInput && (
              <pre className="mt-2 p-2 text-[10px] bg-background/50 rounded border font-mono overflow-auto max-h-32">
                {formatInput(input)}
              </pre>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => handleAction('allow_once')}
            disabled={isSubmitting}
            className="bg-green-500 hover:bg-green-600 text-white"
          >
            <Check size={14} className="mr-1" />
            Allow Once
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('allow_always')}
            disabled={isSubmitting}
          >
            <Check size={14} className="mr-1" />
            Always Allow
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAction('deny')}
            disabled={isSubmitting}
          >
            <X size={14} className="mr-1" />
            Deny
          </Button>

          {/* Auto-deny countdown could go here */}
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            <span>Auto-deny in 5:00</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Permission Request Message Factory
// ============================================================================

/**
 * Create a permission request message from an OpenCode permission request
 */
export function createPermissionMessage(
  taskId: string,
  payload: PermissionRequestPayload
): PermissionRequestMessage {
  return {
    id: `perm-${payload.permissionId}`,
    role: 'assistant',
    type: 'permission-request',
    createdAt: new Date(),
    metadata: {
      permissionId: payload.permissionId,
      taskId,
      toolName: payload.permission,
      description: payload.description,
      input: payload.metadata || {},
      patterns: payload.patterns,
      riskLevel: getRiskLevel(payload.permission),
      autoApproved: false,
      responded: false,
    },
  }
}

// ============================================================================
// Auto-approve helper
// ============================================================================

/**
 * Check if a permission should be auto-approved (e.g., read-only operations)
 */
export function shouldAutoApprove(permission: string): boolean {
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
  const lowerPermission = permission.toLowerCase()
  return readOnlyTools.some((tool) => lowerPermission.includes(tool))
}