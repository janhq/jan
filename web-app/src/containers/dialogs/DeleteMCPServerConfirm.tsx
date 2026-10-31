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

interface DeleteMCPServerConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onConfirm: () => void | Promise<void>
}

export default function DeleteMCPServerConfirm({
  open,
  onOpenChange,
  serverName,
  onConfirm,
}: DeleteMCPServerConfirmProps) {
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
    } catch (error) {
      setError(normalizeAppError(error))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending.current) onOpenChange(value) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('mcp-servers:deleteServer.title')}</DialogTitle>
          <DialogDescription>
            {t('mcp-servers:deleteServer.description', { serverName })}
          </DialogDescription>
        </DialogHeader>
        {error && <div role="alert" className="text-destructive text-sm">{error}</div>}
        <DialogFooter>
          <Button disabled={saving} size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            autoFocus
            disabled={saving}
            onClick={handleConfirm}
          >
            {t('mcp-servers:deleteServer.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
