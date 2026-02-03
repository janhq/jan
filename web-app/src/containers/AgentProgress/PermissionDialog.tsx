import { useState } from 'react'
import type { PermissionRequestPayload } from '@/services/opencode/types'
import { Shield, Check, X, MessageSquare, AlertTriangle } from 'lucide-react'

interface PermissionDialogProps {
  request: PermissionRequestPayload
  onRespond: (
    action: 'allow_once' | 'allow_always' | 'deny',
    message?: string
  ) => void
}

/**
 * Get icon and color for permission type
 */
function getPermissionStyle(permission: string) {
  // Categorize by risk level
  const highRisk = ['edit', 'write', 'delete', 'rm', 'bash', 'shell', 'execute']
  const mediumRisk = ['create', 'mkdir', 'mv', 'move', 'copy']

  const isHighRisk = highRisk.some((r) =>
    permission.toLowerCase().includes(r)
  )
  const isMediumRisk = mediumRisk.some((r) =>
    permission.toLowerCase().includes(r)
  )

  if (isHighRisk) {
    return {
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/20',
      iconColor: 'text-red-500',
      Icon: AlertTriangle,
    }
  }

  if (isMediumRisk) {
    return {
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/20',
      iconColor: 'text-yellow-500',
      Icon: Shield,
    }
  }

  return {
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    iconColor: 'text-blue-500',
    Icon: Shield,
  }
}

export function PermissionDialog({ request, onRespond }: PermissionDialogProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [isResponding, setIsResponding] = useState(false)

  const style = getPermissionStyle(request.permission)

  const handleRespond = async (action: 'allow_once' | 'allow_always' | 'deny') => {
    setIsResponding(true)
    try {
      const message = action === 'deny' && feedback.trim() ? feedback : undefined
      onRespond(action, message)
    } finally {
      setIsResponding(false)
    }
  }

  return (
    <div className={`p-4 border-t ${style.bgColor} ${style.borderColor}`}>
      <div className="flex items-start gap-3">
        <style.Icon className={`${style.iconColor} mt-0.5 shrink-0`} size={20} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="font-medium text-sm">Permission Required</div>

          {/* Description */}
          <p className="text-xs text-muted-foreground mt-1">
            {request.description ||
              `Action: ${request.permission}`}
          </p>

          {/* Patterns */}
          {request.patterns.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {request.patterns.map((pattern, i) => (
                <span
                  key={i}
                  className="text-[10px] bg-background/50 px-1.5 py-0.5 rounded border font-mono"
                >
                  {pattern}
                </span>
              ))}
            </div>
          )}

          {/* Feedback input */}
          {showFeedback && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Provide feedback for the agent (optional)..."
              className="w-full mt-2 p-2 text-xs rounded border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              rows={2}
              disabled={isResponding}
            />
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => handleRespond('allow_once')}
              disabled={isResponding}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check size={14} />
              Allow Once
            </button>

            <button
              onClick={() => handleRespond('allow_always')}
              disabled={isResponding}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check size={14} />
              Always Allow
            </button>

            <button
              onClick={() => handleRespond('deny')}
              disabled={isResponding}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <X size={14} />
              Deny
            </button>

            <button
              onClick={() => setShowFeedback(!showFeedback)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border hover:bg-muted transition-colors"
              title="Add feedback"
            >
              <MessageSquare size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
