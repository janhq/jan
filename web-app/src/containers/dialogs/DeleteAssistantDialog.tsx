import { useRef, useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteAssistantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function DeleteAssistantDialog({
  open,
  onOpenChange,
  onConfirm,
}: DeleteAssistantDialogProps) {
  const { t } = useTranslation()
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [open])

  const handleConfirm = async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      await onConfirm()
    } catch {
      setFailed(true)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const handleCancel = () => {
    if (!pendingRef.current) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!pendingRef.current) onOpenChange(nextOpen)
    }}>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('assistants:deleteConfirmation')}</DialogTitle>
          <DialogDescription>
            {t('assistants:deleteConfirmationDesc')}
          </DialogDescription>
        </DialogHeader>
        {failed && <p role="alert" className="text-sm text-destructive">{t('assistants:deleteFailed')}</p>}
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t('assistants:cancel')}
          </Button>
          <Button
            ref={deleteButtonRef}
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={t('assistants:delete')}
          >
            {t('assistants:delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
