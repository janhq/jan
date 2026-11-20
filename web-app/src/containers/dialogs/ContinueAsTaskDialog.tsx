import { useRef, useState } from 'react'
import { normalizeAppError } from '@/utils/appError'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The chat's attached folder: a task edits it without asking per change. */
  folder: string | null
  onConfirm: () => Promise<void>
}

/**
 * Confirms handing a chat to the Cowork runner. A task works with less asking
 * than a chat does, so the switch is never silent about what it grants.
 */
export function ContinueAsTaskDialog({
  open,
  onOpenChange,
  folder,
  onConfirm,
}: Props) {
  const { t } = useTranslation()
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleConfirm = async () => {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (e) {
      setError(normalizeAppError(e))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending.current) onOpenChange(value)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:continueAsTask.title')}</DialogTitle>
          <DialogDescription>
            {folder
              ? t('common:continueAsTask.descriptionFolder', { folder })
              : t('common:continueAsTask.description')}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert" className="text-destructive text-sm">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={saving}
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('common:cancel')}
          </Button>
          <Button size="sm" autoFocus disabled={saving} onClick={handleConfirm}>
            {t('common:continueAsTask.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
