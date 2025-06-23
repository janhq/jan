import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createValidationSummary, getValidationSeverity } from '@/services/validation'
import { AlertTriangle, Info, XCircle } from 'lucide-react'

interface FolderValidationResult {
  is_valid_jan_folder: boolean
  is_empty: boolean
  has_important_data: boolean
  jan_specific_files: string[]
  folder_size_mb: number
  permissions_ok: boolean
  error_message?: string
  warnings: string[]
}

interface ValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  validation: FolderValidationResult | null
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
  loading?: boolean
}

const ValidationDialog: React.FC<ValidationDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  validation,
  onConfirm,
  onCancel,
  confirmText = 'Proceed',
  cancelText = 'Cancel',
  loading = false,
}) => {
  if (!validation) return null

  const severity = getValidationSeverity(validation)
  const summary = createValidationSummary(validation)
  const hasError = !!validation.error_message
  const hasWarnings = validation.warnings.length > 0

  const getSeverityIcon = () => {
    switch (severity) {
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      default:
        return <Info className="h-4 w-4 text-blue-500" />
    }
  }

  const getSeverityColor = () => {
    switch (severity) {
      case 'error':
        return 'border-red-200 bg-red-50 text-red-800'
      case 'warning':
        return 'border-yellow-200 bg-yellow-50 text-yellow-800'
      default:
        return 'border-blue-200 bg-blue-50 text-blue-800'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getSeverityIcon()}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={`rounded-md border p-4 ${getSeverityColor()}`}>
            <pre className="whitespace-pre-wrap text-sm font-mono">
              {summary}
            </pre>
          </div>

          {hasError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-800">
                <XCircle className="h-4 w-4" />
                <span className="font-medium">Cannot Proceed</span>
              </div>
              <p className="mt-2 text-sm text-red-700">
                This operation cannot proceed due to validation errors. Please
                resolve the issues above before continuing.
              </p>
            </div>
          )}

          {!hasError && hasWarnings && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
              <div className="flex items-center gap-2 text-yellow-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Warning</span>
              </div>
              <p className="mt-2 text-sm text-yellow-700">
                This operation has warnings. Please review them carefully before
                proceeding. This action may result in data loss.
              </p>
            </div>
          )}

          {!hasError && validation.has_important_data && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Important Data Warning</span>
              </div>
              <p className="mt-2 text-sm text-red-700">
                <strong>Warning:</strong> This folder contains important data
                including conversations, models, or other user data. This data
                will be permanently affected by this operation.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="link" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={hasError || loading}
            variant={hasWarnings ? 'destructive' : 'default'}
          >
            {loading ? 'Processing...' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ValidationDialog