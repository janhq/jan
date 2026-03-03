import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  IconCheck,
  IconLoader2,
  IconAlertTriangle,
  IconExternalLink,
  IconRefresh,
} from '@tabler/icons-react'
import { setOpenClawRunningState, syncAllModelsToOpenClaw } from '@/utils/openclaw'
import { useModelProvider } from '@/hooks/useModelProvider'

interface EnableProgressEvent {
  step: string
  progress: number
  message: string
  sandbox_info?: string
}

interface EnableResult {
  success: boolean
  already_installed: boolean
  steps_completed: string[]
  status: {
    installed: boolean
    running: boolean
    node_version: string | null
    openclaw_version: string | null
    port_available: boolean
    error: string | null
  }
}

interface EnableError {
  code: string
  message: string
  recovery: {
    label: string
    action: RecoveryAction
    description: string
  }[]
}

type RecoveryAction =
  | 'Retry'
  | 'OpenNodeDownload'
  | { UseDifferentPort: { port: number } }

interface EnableProgressDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const STEP_LABELS: Record<string, string> = {
  checking_dependencies: 'Checking Node.js',
  checking_installation: 'Checking OpenClaw',
  installing: 'Installing OpenClaw',
  already_installed: 'OpenClaw installed',
  configuring: 'Configuring',
  starting: 'Starting gateway',
  syncing_models: 'Syncing models',
  complete: 'Complete',
}

function parseEnableError(errorStr: string): EnableError | null {
  try {
    return JSON.parse(errorStr) as EnableError
  } catch {
    return null
  }
}

export function EnableProgressDialog({
  isOpen,
  onOpenChange,
  onSuccess,
}: EnableProgressDialogProps) {
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState('')
  const [sandboxInfo, setSandboxInfo] = useState<string | null>(null)
  const [error, setError] = useState<EnableError | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isDone, setIsDone] = useState(false)

  const resetState = useCallback(() => {
    setProgress(0)
    setMessage('')
    setCompletedSteps([])
    setCurrentStep('')
    setSandboxInfo(null)
    setError(null)
    setIsRunning(false)
    setIsDone(false)
  }, [])

  const runEnable = useCallback(async () => {
    resetState()
    setIsRunning(true)

    try {
      const result = await invoke<EnableResult>('openclaw_enable', {
        configInput: null,
      })

      if (result.success) {
        setOpenClawRunningState(true)
        // Sync models after gateway starts
        setProgress(95)
        setMessage('Syncing models...')
        setCurrentStep('syncing_models')
        try {
          const { providers, selectedModel } = useModelProvider.getState()
          await syncAllModelsToOpenClaw(providers, selectedModel?.id)
        } catch {
          // Non-fatal — models can be synced later
        }

        setProgress(100)
        setMessage('OpenClaw is ready!')
        setCurrentStep('complete')
        setIsDone(true)
        toast.success('Remote access enabled successfully')
        onSuccess?.()
      }
    } catch (err) {
      const errorStr = err instanceof Error ? err.message : String(err)
      const parsed = parseEnableError(errorStr)
      if (parsed) {
        setError(parsed)
      } else {
        setError({
          code: 'Unknown',
          message: errorStr,
          recovery: [
            {
              label: 'Retry',
              action: 'Retry',
              description: 'Try again.',
            },
          ],
        })
      }
    } finally {
      setIsRunning(false)
    }
  }, [resetState, onSuccess])

  // Listen for progress events
  useEffect(() => {
    if (!isOpen) return

    const unlisten = listen<EnableProgressEvent>(
      'openclaw-enable-progress',
      (event) => {
        const { step, progress: p, message: msg, sandbox_info } = event.payload
        setProgress(p)
        setMessage(msg)
        setCurrentStep(step)
        if (sandbox_info) {
          setSandboxInfo(sandbox_info)
        }
        setCompletedSteps((prev) => {
          if (step !== prev[prev.length - 1]) {
            return [...prev, step]
          }
          return prev
        })
      }
    )

    return () => {
      unlisten.then((f) => f())
    }
  }, [isOpen])

  // Start the enable flow when dialog opens
  useEffect(() => {
    if (isOpen && !isRunning && !isDone && !error) {
      runEnable()
    }
  }, [isOpen, isRunning, isDone, error, runEnable])

  // Reset when dialog closes
  useEffect(() => {
    if (!isOpen) {
      resetState()
    }
  }, [isOpen, resetState])

  const handleRecoveryAction = (action: RecoveryAction) => {
    if (action === 'Retry') {
      setError(null)
      // runEnable will be triggered by the useEffect
    } else if (action === 'OpenNodeDownload') {
      window.open('https://nodejs.org/', '_blank')
    } else if (
      typeof action === 'object' &&
      'UseDifferentPort' in action
    ) {
      // For now, retry is the main action - port config can be extended later
      setError(null)
    }
  }

  const allSteps = [
    'checking_dependencies',
    'checking_installation',
    'installing',
    'configuring',
    'starting',
    'complete',
  ]

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {error
              ? 'Setup Failed'
              : isDone
                ? 'Setup Complete'
                : 'Setting Up Remote Access'}
          </DialogTitle>
          <DialogDescription>
            {error
              ? 'An error occurred during setup.'
              : isDone
                ? 'OpenClaw is running and ready to use.'
                : 'Installing and configuring OpenClaw...'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Progress bar */}
          {!error && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground text-center">
                {message}
              </p>
            </div>
          )}

          {/* Step list */}
          {!error && (
            <div className="space-y-2">
              {allSteps.map((step) => {
                const isCompleted = completedSteps.includes(step)
                const isCurrent = currentStep === step && !isDone
                const label = STEP_LABELS[step] || step

                // Show sandbox info next to specific steps
                const showSandboxInfo = sandboxInfo && (
                  step === 'checking_dependencies' ||
                  step === 'starting' ||
                  step === 'complete'
                )

                // Skip install step if it didn't happen
                if (
                  step === 'installing' &&
                  !completedSteps.includes('installing') &&
                  completedSteps.includes('configuring')
                ) {
                  return null
                }

                return (
                  <div
                    key={step}
                    className="flex items-center gap-2 text-sm"
                  >
                    {isCompleted && !isCurrent ? (
                      <IconCheck className="h-4 w-4 text-green-500 shrink-0" />
                    ) : isCurrent ? (
                      <IconLoader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-muted-foreground/30 shrink-0" />
                    )}
                    <span
                      className={
                        isCurrent
                          ? 'text-foreground font-medium'
                          : isCompleted
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/50'
                      }
                    >
                      {label}
                    </span>
                    {showSandboxInfo && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {sandboxInfo}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <IconAlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error.message}</p>
              </div>
              <div className="flex flex-col gap-2">
                {error.recovery.map((option, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => handleRecoveryAction(option.action)}
                  >
                    {option.action === 'OpenNodeDownload' ? (
                      <IconExternalLink className="mr-2 h-4 w-4" />
                    ) : (
                      <IconRefresh className="mr-2 h-4 w-4" />
                    )}
                    {option.label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Done state - close button */}
          {isDone && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
